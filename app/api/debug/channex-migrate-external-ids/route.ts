import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet } from "@/lib/channels/channex-core";
import { revokeAccessCodesForReservation } from "@/lib/ttlock";

// Migrates Channex reservations still keyed under the pre-dedup externalId
// scheme, and removes the duplicates that scheme change caused.
//
// Background: the duplicate fix changed externalId from
// `channex-{booking_room_id}` to `channex-{booking_id}-{listing_id}` but left
// existing rows alone. Those rows are unrecognisable to every lookup that now
// assumes the new shape, so upsertReservationsFromChannexBooking treated
// already-imported bookings as new and wrote a second row - with its own
// access code on the physical lock - alongside each original.
//
// For a duplicated pair the ORIGINAL (old-format) row is kept, not the newer
// one: it carries the true import time (which NEW_RESERVATION message
// templates key off) and the access codes already issued to that stay. The
// newer row is deleted, its lock codes properly revoked. The surviving row is
// then re-keyed to the new scheme.
//
// Old rows with no duplicate are simply re-keyed.
//
//   GET /api/debug/channex-migrate-external-ids            -> dry run
//   GET /api/debug/channex-migrate-external-ids?confirm=true -> applies
const CHANNEX_PREFIX = "channex-";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isNewFormat(externalId: string): boolean {
  const rest = externalId.slice(CHANNEX_PREFIX.length);
  return rest.length > 36 && UUID_RE.test(rest.slice(0, 36)) && rest[36] === "-";
}

interface BookingListEntry {
  id: string;
  attributes: { id: string; rooms?: Array<{ booking_room_id: string }> };
}

// GET /bookings pages at 10 by default, well under the number of bookings on
// this account, so every page has to be walked to build a complete
// room -> booking map. The loop stops when a page yields no ids it hasn't
// already seen, which terminates correctly even if the pagination parameter
// name is wrong (the API would just keep returning page 1) rather than
// looping forever on a bad guess.
async function fetchAllBookings(): Promise<{ bookings: BookingListEntry[]; total: number | null; pagesWalked: number }> {
  const seen = new Map<string, BookingListEntry>();
  let total: number | null = null;
  let pagesWalked = 0;

  for (let page = 1; page <= 20; page++) {
    const res = await channexGet<BookingListEntry[]>(`/bookings?pagination[page]=${page}&pagination[limit]=100`);
    pagesWalked++;
    const batch = res.data ?? [];
    const metaTotal = (res.meta as { total?: number } | undefined)?.total;
    if (typeof metaTotal === "number") total = metaTotal;

    let added = 0;
    for (const b of batch) {
      const id = b.attributes?.id ?? b.id;
      if (id && !seen.has(id)) {
        seen.set(id, b);
        added++;
      }
    }
    if (added === 0) break;
    if (total !== null && seen.size >= total) break;
  }

  return { bookings: [...seen.values()], total, pagesWalked };
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const reservations = await prisma.reservation.findMany({
    where: { externalId: { startsWith: CHANNEX_PREFIX }, property: { ownerId: userId } },
    include: { guest: { select: { id: true, name: true } }, property: { select: { id: true, ownerId: true } } },
    orderBy: { createdAt: "asc" },
  });

  const listings = await prisma.channexListing.findMany({ select: { id: true, propertyId: true } });
  const listingByProperty = new Map(listings.map((l) => [l.propertyId, l.id]));

  const { bookings, total, pagesWalked } = await fetchAllBookings();
  const bookingIdByRoomId = new Map<string, string>();
  for (const b of bookings) {
    const bookingId = b.attributes?.id ?? b.id;
    for (const room of b.attributes?.rooms ?? []) {
      if (room.booking_room_id) bookingIdByRoomId.set(room.booking_room_id, bookingId);
    }
  }

  const oldRows = reservations.filter((r) => r.externalId && !isNewFormat(r.externalId));
  const existingNewIds = new Map(
    reservations.filter((r) => r.externalId && isNewFormat(r.externalId)).map((r) => [r.externalId as string, r])
  );

  const plan: Array<Record<string, unknown>> = [];

  for (const row of oldRows) {
    const roomId = (row.externalId as string).slice(CHANNEX_PREFIX.length);
    const bookingId = bookingIdByRoomId.get(roomId);
    const listingId = listingByProperty.get(row.propertyId);

    if (!bookingId || !listingId) {
      plan.push({
        action: "skip",
        reservationId: row.id,
        guest: row.guest.name,
        externalId: row.externalId,
        reason: !bookingId
          ? "no Channex booking found containing that booking_room_id (booking may have aged out of the sandbox)"
          : "property has no ChannexListing",
      });
      continue;
    }

    const targetExternalId = `${CHANNEX_PREFIX}${bookingId}-${listingId}`;
    const duplicate = existingNewIds.get(targetExternalId);

    plan.push({
      action: duplicate ? "merge" : "rekey",
      keepReservationId: row.id,
      guest: row.guest.name,
      fromExternalId: row.externalId,
      toExternalId: targetExternalId,
      deleteReservationId: duplicate?.id ?? null,
    });
  }

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing changed",
      bookingsFetched: bookings.length,
      bookingsTotalReported: total,
      pagesWalked,
      oldFormatRows: oldRows.length,
      plan,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const step of plan) {
    if (step.action === "skip") {
      results.push(step);
      continue;
    }

    const keepId = step.keepReservationId as string;
    const deleteId = step.deleteReservationId as string | null;
    let revokedCodes = 0;
    const lockErrors: string[] = [];

    if (deleteId) {
      const dupe = reservations.find((r) => r.id === deleteId);
      if (dupe) {
        const revoke = await revokeAccessCodesForReservation(dupe.id, dupe.property.ownerId);
        revokedCodes = revoke.revoked;
        lockErrors.push(...revoke.lockErrors);
        await prisma.cleaningTask.deleteMany({ where: { reservationId: dupe.id } });
        // AccessCode and Message reference Reservation without cascade, and
        // revoke only deactivates codes - the rows still have to go first.
        await prisma.accessCode.deleteMany({ where: { reservationId: dupe.id } });
        await prisma.message.deleteMany({ where: { reservationId: dupe.id } });
        await prisma.messageTemplateSend.deleteMany({ where: { reservationId: dupe.id } });
        await prisma.reservation.delete({ where: { id: dupe.id } });
        const guestStillUsed = await prisma.reservation.count({ where: { guestId: dupe.guest.id } });
        if (guestStillUsed === 0) await prisma.guest.delete({ where: { id: dupe.guest.id } }).catch(() => {});
      }
    }

    await prisma.reservation.update({
      where: { id: keepId },
      data: { externalId: step.toExternalId as string },
    });

    results.push({ ...step, revokedCodes, lockErrors });
  }

  return NextResponse.json({ applied: true, steps: results.length, results });
}
