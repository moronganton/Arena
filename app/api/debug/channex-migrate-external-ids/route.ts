import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, ChannexError } from "@/lib/channels/channex-core";
import { releaseCancelledReservation } from "@/lib/channels/channex-bookings";

// Migrates every Channex reservation created before commit a6f0481 off the
// buggy externalId scheme (built from the REVISION's own id, different on
// every delivery) onto the correct one (built from booking_id, stable
// across every revision of the same booking).
//
// Confirmed live and not hypothetical: a real modify on a real booking
// created a second reservation instead of updating the first, and the
// booking's own real cancellation was then silently dropped because the
// surviving row was still filed under the old scheme. Every reservation
// created before the fix carries the same latent problem - it just hasn't
// been touched by a second revision yet.
//
// Two things happen per candidate:
//
//   1. Recompute what its externalId SHOULD be. GET /booking_revisions/<id>
//      where <id> is whatever UUID the current externalId embeds. If that id
//      is a real, fetchable revision, the row is on the old scheme and the
//      response's booking_id is the correct one to use. If Channex 404s,
//      the embedded id was never a revision id to begin with - almost
//      certainly already the correct booking_id - and the row is left as is.
//
//   2. Group every reservation (already-correct and about-to-be-migrated
//      alike) by what its externalId should be. A group with more than one
//      row means the SAME real booking was split across multiple
//      reservations by this bug. Cancellation is terminal in Booking.com's
//      model - a cancelled booking cannot come back "confirmed" without
//      becoming a new booking with a new booking_id - so if any row in a
//      group is CANCELLED, that is the group's true final state and the
//      newest CANCELLED row survives. Otherwise the newest row survives,
//      on the reasoning that later processing reflects a later revision.
//      Every other row in the group is retired: door codes revoked from
//      the real lock, pending cleaning task dropped, marked CANCELLED as
//      a superseded duplicate rather than left CONFIRMED with no code and
//      no cleaner, which would just be a different kind of wrong.
//
// Dry run by default. Nothing is written unless &apply=true.
//
//   GET /api/debug/channex-migrate-external-ids
//   GET /api/debug/channex-migrate-external-ids?apply=true

const CHANNEX_PREFIX = "channex-";
const UUID_LENGTH = 36;
const MIN_MS_BETWEEN_CALLS = 3500; // same conservative spacing used throughout this integration

function splitExternalId(externalId: string): { idPart: string; listingIdPart: string } | null {
  if (!externalId.startsWith(CHANNEX_PREFIX)) return null;
  const rest = externalId.slice(CHANNEX_PREFIX.length);
  if (rest.length <= UUID_LENGTH + 1) return null; // no room for "<uuid>-<listingId>"
  const idPart = rest.slice(0, UUID_LENGTH);
  const listingIdPart = rest.slice(UUID_LENGTH + 1); // skip the separating dash
  return { idPart, listingIdPart };
}

interface Candidate {
  id: string;
  externalId: string;
  status: string;
  checkIn: Date;
  checkOut: Date;
  createdAt: Date;
  guestName: string;
  propertyName: string;
  ownerId: string;
  accessCodeCount: number;
  idPart: string;
  listingIdPart: string;
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const apply = new URL(req.url).searchParams.get("apply") === "true";

  const rows = await prisma.reservation.findMany({
    where: { externalId: { startsWith: CHANNEX_PREFIX }, property: { ownerId: access.userId } },
    select: {
      id: true,
      externalId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      createdAt: true,
      guest: { select: { name: true } },
      property: { select: { name: true, ownerId: true } },
      _count: { select: { accessCodes: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates: Candidate[] = [];
  const unparseable: string[] = [];
  for (const r of rows) {
    const split = splitExternalId(r.externalId!);
    if (!split) {
      unparseable.push(r.externalId!);
      continue;
    }
    candidates.push({
      id: r.id,
      externalId: r.externalId!,
      status: r.status,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      createdAt: r.createdAt,
      guestName: r.guest.name,
      propertyName: r.property.name,
      ownerId: r.property.ownerId,
      accessCodeCount: r._count.accessCodes,
      idPart: split.idPart,
      listingIdPart: split.listingIdPart,
    });
  }

  // Resolve each DISTINCT embedded id once, not once per reservation -
  // several rows can share one id part only in edge cases, but there is no
  // reason to spend a call twice on the same lookup.
  const uniqueIdParts = [...new Set(candidates.map((c) => c.idPart))];
  const resolved = new Map<string, { correctBookingId: string; wasOldScheme: boolean } | { error: string }>();

  let lastCallAt = 0;
  for (const idPart of uniqueIdParts) {
    const wait = lastCallAt === 0 ? 0 : MIN_MS_BETWEEN_CALLS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();

    try {
      const res = await channexGet<{ attributes?: { booking_id?: string } }>(`/booking_revisions/${idPart}`);
      const bookingId = res.data?.attributes?.booking_id;
      if (bookingId) {
        resolved.set(idPart, { correctBookingId: bookingId, wasOldScheme: true });
      } else {
        // Fetchable as a revision, but the response is missing booking_id -
        // treat as unresolved rather than guess.
        resolved.set(idPart, { error: "revision found but no booking_id in response" });
      }
    } catch (err) {
      const e = err as ChannexError;
      if (e.status === 404) {
        // Not a real revision id - this row is already on the correct scheme.
        resolved.set(idPart, { correctBookingId: idPart, wasOldScheme: false });
      } else {
        resolved.set(idPart, { error: `${e.message} (status ${e.status ?? "?"})` });
      }
    }
  }

  // Every candidate's TARGET externalId, using its resolved booking_id.
  // Unresolved (errored) candidates are left out of the grouping entirely -
  // they are reported separately and never touched.
  const targetGroups = new Map<string, Candidate[]>();
  const unresolved: Array<{ reservationId: string; externalId: string; reason: string }> = [];

  for (const c of candidates) {
    const r = resolved.get(c.idPart)!;
    if ("error" in r) {
      unresolved.push({ reservationId: c.id, externalId: c.externalId, reason: r.error });
      continue;
    }
    const target = `channex-${r.correctBookingId}-${c.listingIdPart}`;
    const list = targetGroups.get(target) ?? [];
    list.push(c);
    targetGroups.set(target, list);
  }

  interface GroupPlan {
    targetExternalId: string;
    members: number;
    survivor: { reservationId: string; guest: string; property: string; stay: string; status: string; externalIdChanges: boolean };
    retire: Array<{ reservationId: string; guest: string; stay: string; status: string; activeCodes: number }>;
  }

  const plan: GroupPlan[] = [];
  for (const [target, members] of targetGroups) {
    // Cancellation is terminal - if anything in the group is cancelled,
    // that is the group's real final state regardless of what any other
    // member's status says.
    const anyCancelled = members.some((m) => m.status === "CANCELLED");
    const pool = anyCancelled ? members.filter((m) => m.status === "CANCELLED") : members;
    const survivor = pool.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest), pool[0]);
    const retire = members.filter((m) => m.id !== survivor.id);

    plan.push({
      targetExternalId: target,
      members: members.length,
      survivor: {
        reservationId: survivor.id,
        guest: survivor.guestName,
        property: survivor.propertyName,
        stay: `${survivor.checkIn.toISOString().slice(0, 10)} -> ${survivor.checkOut.toISOString().slice(0, 10)}`,
        status: survivor.status,
        externalIdChanges: survivor.externalId !== target,
      },
      retire: retire.map((m) => ({
        reservationId: m.id,
        guest: m.guestName,
        stay: `${m.checkIn.toISOString().slice(0, 10)} -> ${m.checkOut.toISOString().slice(0, 10)}`,
        status: m.status,
        activeCodes: m.accessCodeCount,
      })),
    });
  }

  const groupsWithDuplicates = plan.filter((p) => p.members > 1);
  const externalIdOnlyChanges = plan.filter((p) => p.members === 1 && p.survivor.externalIdChanges);
  const alreadyCorrect = plan.filter((p) => p.members === 1 && !p.survivor.externalIdChanges);

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing has been changed",
      totalCandidates: candidates.length,
      alreadyCorrect: alreadyCorrect.length,
      externalIdOnlyChanges: externalIdOnlyChanges.length,
      duplicateGroupsFound: groupsWithDuplicates.length,
      unresolved: unresolved.length,
      unparseableExternalIds: unparseable,
      hint: "Re-run with &apply=true to rename externalIds and retire superseded duplicates.",
      duplicateGroups: groupsWithDuplicates,
      externalIdRenamesOnly: externalIdOnlyChanges,
      unresolvedDetail: unresolved,
    });
  }

  const renamed: string[] = [];
  const retired: string[] = [];
  const errors: string[] = [];

  for (const p of plan) {
    try {
      if (p.survivor.externalIdChanges) {
        await prisma.reservation.update({ where: { id: p.survivor.reservationId }, data: { externalId: p.targetExternalId } });
        renamed.push(p.survivor.reservationId);
      }
      for (const dupe of p.retire) {
        const ownerId = candidates.find((c) => c.id === dupe.reservationId)!.ownerId;
        if (dupe.status !== "CANCELLED") {
          await prisma.reservation.update({ where: { id: dupe.reservationId }, data: { status: "CANCELLED" } });
        }
        await releaseCancelledReservation(dupe.reservationId, ownerId, `externalId migration: superseded by ${p.survivor.reservationId}`);
        retired.push(dupe.reservationId);
      }
    } catch (err) {
      errors.push(`${p.targetExternalId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    mode: "applied",
    renamed: renamed.length,
    retired: retired.length,
    errors,
  });
}
