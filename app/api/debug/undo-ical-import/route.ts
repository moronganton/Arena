import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { revokeAccessCodesForReservation } from "@/lib/ttlock";

// Removes reservations created by the calendar-feed importer on a property
// that is owned by a channel manager - rows that should never have existed.
//
// Dry run by default. Nothing is removed unless ?apply=true is passed.
//
//   GET /api/debug/undo-ical-import                 (dry run, all affected)
//   GET /api/debug/undo-ical-import?propertyId=xxx  (limit to one property)
//   GET /api/debug/undo-ical-import?apply=true      (actually remove them)
//
// Targets are chosen by writer fingerprint and by the property's manager,
// not by a date range: an externalId that is neither smoobu-, channex-, nor
// a bare Booking.com numeric id came from the iCal path, and a property with
// channelProvider SMOOBU or CHANNEX must never have been written by it.
// Anything a human entered by hand has no externalId at all and is excluded.
//
// Door codes are revoked BEFORE the row is deleted. Deleting a reservation
// that owns a live PIN would leave that PIN working on a real lock with
// nothing left in StayHQ pointing at it - an open door no one can find.

// Deliberately a POSITIVE match, not "everything I don't recognise".
//
// The first version of this excluded the writers it knew and treated the
// rest as iCal. That is the wrong shape for a delete tool: a real
// hand-entered reservation carrying externalId "manual-HMH8CR9EZC" matched
// none of the exclusions and would have been deleted. A tool that removes
// data has to name what it takes, not what it spares.
//
// An iCal UID is "<unique>@<domain>" - Airbnb, Booking.com and VRBO all
// emit that shape, and it is what every affected row in this database
// actually looks like. Anything else is left alone and reported, so a row
// this does not recognise is visible rather than silently swept up.
function isIcalWriter(externalId: string | null): boolean {
  if (!externalId) return false; // manual entry - never touched
  if (externalId.startsWith("smoobu-")) return false;
  if (externalId.startsWith("channex-")) return false;
  if (externalId.startsWith("manual-")) return false;
  if (/^\d+$/.test(externalId)) return false; // Booking.com API import
  return externalId.includes("@");
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "true";
  const propertyId = searchParams.get("propertyId");
  // Scope to rows written after a moment - e.g. only the batch from one bad
  // sync, leaving a year of older imports to be judged separately.
  const createdAfterRaw = searchParams.get("createdAfter");
  const createdAfter = createdAfterRaw ? new Date(createdAfterRaw) : null;
  if (createdAfter && Number.isNaN(createdAfter.getTime())) {
    return NextResponse.json({ error: `createdAfter is not a valid date: ${createdAfterRaw}` }, { status: 400 });
  }
  // Revoke the door codes but keep the reservation rows. The fastest safe
  // move when live PINs are the urgent part and what to do with the history
  // is still an open question.
  const codesOnly = searchParams.get("codesOnly") === "true";

  const candidates = await prisma.reservation.findMany({
    where: {
      externalId: { not: null },
      ...(createdAfter ? { createdAt: { gte: createdAfter } } : {}),
      property: {
        ownerId: access.userId,
        channelProvider: { in: ["SMOOBU", "CHANNEX"] },
        ...(propertyId ? { id: propertyId } : {}),
      },
    },
    select: {
      id: true,
      externalId: true,
      source: true,
      status: true,
      checkIn: true,
      checkOut: true,
      createdAt: true,
      guest: { select: { id: true, name: true } },
      property: { select: { id: true, name: true, ownerId: true, channelProvider: true } },
      accessCodes: { select: { id: true, isActive: true, ttlockKeyId: true } },
      _count: { select: { messages: true, cleaningTasks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const targets = candidates.filter((r) => isIcalWriter(r.externalId));

  // Everything in range that this refuses to touch, named explicitly. A
  // delete tool should make its exclusions inspectable rather than leave
  // the operator to trust that the filter was right.
  const spared = candidates
    .filter((r) => !isIcalWriter(r.externalId))
    .map((r) => ({ externalId: r.externalId, guest: r.guest.name, property: r.property.name }));

  const plan = targets.map((r) => ({
    reservationId: r.id,
    property: r.property.name,
    managedBy: r.property.channelProvider,
    guest: r.guest.name,
    source: r.source,
    status: r.status,
    stay: `${r.checkIn.toISOString().slice(0, 10)} -> ${r.checkOut.toISOString().slice(0, 10)}`,
    createdAt: r.createdAt.toISOString(),
    externalId: r.externalId,
    accessCodes: r.accessCodes.length,
    // A code that reached the physical lock has to be revoked there, not
    // just deleted here.
    codesOnRealLocks: r.accessCodes.filter((c) => c.ttlockKeyId).length,
    messages: r._count.messages,
    cleaningTasks: r._count.cleaningTasks,
  }));

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing has been changed",
      wouldAffect: plan.length,
      action: codesOnly ? "revoke door codes only, keep the reservations" : "revoke door codes AND delete the reservations",
      totalCodesToRevoke: plan.reduce((n, p) => n + p.accessCodes, 0),
      codesThatReachedARealLock: plan.reduce((n, p) => n + p.codesOnRealLocks, 0),
      hint: "Re-run with &apply=true. Add &codesOnly=true to revoke PINs without deleting rows, " +
        "or &createdAfter=2026-08-20T22:00:00Z to limit this to one sync's batch.",
      notTouched: spared,
      plan,
    });
  }

  const removed: string[] = [];
  const errors: string[] = [];
  let codesRevoked = 0;

  for (const r of targets) {
    try {
      if (r.accessCodes.length > 0) {
        const { lockErrors } = await revokeAccessCodesForReservation(r.id, r.property.ownerId);
        codesRevoked += r.accessCodes.length;
        // A code the lock refused to drop is still live on the door. That
        // has to reach the operator, not just the log.
        if (lockErrors.length) errors.push(`${r.id} lock: ${lockErrors.join("; ")}`);
      }

      if (codesOnly) {
        removed.push(r.id);
        continue;
      }

      // Dependent rows first - these relations have no cascade, so the
      // delete below fails outright if anything still points at the row.
      await prisma.message.deleteMany({ where: { reservationId: r.id } });
      await prisma.accessCode.deleteMany({ where: { reservationId: r.id } });
      await prisma.cleaningTask.deleteMany({ where: { reservationId: r.id } });
      await prisma.reservation.delete({ where: { id: r.id } });
      removed.push(r.id);

      // The placeholder guest the importer invented for a calendar entry
      // ("Airbnb (Not available)") is worth removing with it, but only if
      // nothing else ever attached to it.
      const stillUsed = await prisma.reservation.count({ where: { guestId: r.guest.id } });
      if (stillUsed === 0) {
        await prisma.guest.delete({ where: { id: r.guest.id } }).catch(() => {});
      }
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    mode: codesOnly ? "applied - codes revoked, reservations kept" : "applied - codes revoked and reservations deleted",
    affected: removed.length,
    codesRevoked,
    notTouched: spared.length,
    errors,
  });
}
