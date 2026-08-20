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

function isIcalWriter(externalId: string | null): boolean {
  if (!externalId) return false; // manual entry - never touched
  if (externalId.startsWith("smoobu-")) return false;
  if (externalId.startsWith("channex-")) return false;
  if (/^\d+$/.test(externalId)) return false; // Booking.com API import
  return true;
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "true";
  const propertyId = searchParams.get("propertyId");

  const candidates = await prisma.reservation.findMany({
    where: {
      externalId: { not: null },
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
      wouldRemove: plan.length,
      totalCodesToRevoke: plan.reduce((n, p) => n + p.accessCodes, 0),
      codesThatReachedARealLock: plan.reduce((n, p) => n + p.codesOnRealLocks, 0),
      hint: "Re-run with &apply=true to remove these.",
      plan,
    });
  }

  const removed: string[] = [];
  const errors: string[] = [];
  let codesRevoked = 0;

  for (const r of targets) {
    try {
      if (r.accessCodes.length > 0) {
        await revokeAccessCodesForReservation(r.id, r.property.ownerId);
        codesRevoked += r.accessCodes.length;
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
    mode: "applied",
    removed: removed.length,
    codesRevoked,
    errors,
  });
}
