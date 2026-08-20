import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Audits Channex reservation externalId formats.
//
// The duplicate-reservation fix changed the externalId scheme from
// `channex-{booking_room_id}` (one row per Channex room line) to
// `channex-{booking_id}-{listing_id}` (one row per booking+property), but did
// not migrate rows already written under the old scheme. Anything keyed the
// old way is invisible to every lookup that now assumes the new one:
//
//   - channexBookingIdFromExternalId slices out a ROOM id and calls the API
//     with it as a BOOKING id
//   - findReservationByChannexBookingId matches on `channex-{id}-`, which an
//     old-format id never satisfies (no trailing segment)
//   - upsertReservationsFromChannexBooking therefore treats the booking as
//     new and writes a SECOND row alongside the old one
//
// This reports the split so the actual damage is measured before anything is
// changed, rather than inferred.
//
//   GET /api/debug/channex-external-id-audit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const reservations = await prisma.reservation.findMany({
    where: { externalId: { startsWith: "channex-" }, property: { ownerId: session.user.id } },
    include: { guest: { select: { name: true } }, property: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const newFormat: unknown[] = [];
  const oldFormat: unknown[] = [];

  for (const r of reservations) {
    const rest = (r.externalId ?? "").slice("channex-".length);
    // New format is a 36-char UUID followed by "-" + a cuid; old format is a
    // bare 36-char UUID with nothing after it.
    const isNew = rest.length > 36 && UUID_RE.test(rest.slice(0, 36)) && rest[36] === "-";
    const row = {
      id: r.id,
      externalId: r.externalId,
      guest: r.guest.name,
      confirmationCode: r.confirmationCode,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      createdAt: r.createdAt,
    };
    if (isNew) newFormat.push(row);
    else oldFormat.push(row);
  }

  // Same booking represented twice - once under each scheme. This is the
  // duplicate the format change would have reintroduced.
  const byCode = new Map<string, typeof reservations>();
  for (const r of reservations) {
    if (!r.confirmationCode) continue;
    const list = byCode.get(r.confirmationCode) ?? [];
    list.push(r);
    byCode.set(r.confirmationCode, list);
  }
  const duplicateCodes = [...byCode.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([code, list]) => ({
      confirmationCode: code,
      guest: list[0].guest.name,
      rows: list.map((r) => ({ id: r.id, externalId: r.externalId, createdAt: r.createdAt })),
    }));

  return NextResponse.json({
    total: reservations.length,
    newFormatCount: newFormat.length,
    oldFormatCount: oldFormat.length,
    duplicateConfirmationCodes: duplicateCodes.length,
    duplicates: duplicateCodes,
    oldFormat,
    newFormat,
  });
}
