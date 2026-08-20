import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { revokeAccessCodesForReservation } from "@/lib/ttlock";

// One-time cleanup for the duplicate reservations the first version of
// upsertReservationsFromChannexBooking created: it keyed one Reservation per
// Channex room line-item, so a booking with two mapped room lines for the
// same property/dates (Channex's shared sandbox hotel does this for
// group/certification test bookings) became two reservations instead of one,
// each with its own real access code on the real lock. The fixed logic keys
// on (booking, property) instead - this finds groups sharing the same
// confirmationCode + property (every room line in one Channex booking shares
// the same confirmationCode) and collapses each group down to the earliest
// reservation, properly revoking the extra access codes on the physical lock
// rather than just deleting rows.
//
//   GET /api/debug/channex-merge-duplicate-reservations            -> dry run
//   GET /api/debug/channex-merge-duplicate-reservations?confirm=true -> applies
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const candidates = await prisma.reservation.findMany({
    where: {
      externalId: { startsWith: "channex-" },
      property: { ownerId: userId },
      confirmationCode: { not: null },
    },
    include: { property: { select: { id: true, name: true, ownerId: true } }, guest: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof candidates>();
  for (const r of candidates) {
    const key = `${r.confirmationCode}::${r.propertyId}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);

  const plan = duplicateGroups.map((g) => ({
    confirmationCode: g[0].confirmationCode,
    property: g[0].property.name,
    keep: { id: g[0].id, guest: g[0].guest.name, checkIn: g[0].checkIn, checkOut: g[0].checkOut },
    remove: g.slice(1).map((r) => ({ id: r.id, guest: r.guest.name, checkIn: r.checkIn, checkOut: r.checkOut })),
  }));

  if (!confirm) {
    return NextResponse.json({ mode: "dry run - nothing changed", duplicateGroups: plan.length, plan });
  }

  const results: Array<{ removed: string; revokedCodes: number; lockErrors: string[] }> = [];
  for (const g of duplicateGroups) {
    for (const dupe of g.slice(1)) {
      const revoke = await revokeAccessCodesForReservation(dupe.id, dupe.property.ownerId);
      await prisma.cleaningTask.deleteMany({ where: { reservationId: dupe.id } });
      // AccessCode and Message both reference Reservation with no cascade -
      // revokeAccessCodesForReservation only deactivates codes (removes them
      // from the physical lock, leaves the row), so the rows still have to
      // go before the Reservation delete itself is allowed.
      await prisma.accessCode.deleteMany({ where: { reservationId: dupe.id } });
      await prisma.message.deleteMany({ where: { reservationId: dupe.id } });
      await prisma.reservation.delete({ where: { id: dupe.id } });
      const otherReservations = await prisma.reservation.count({ where: { guestId: dupe.guest.id } });
      if (otherReservations === 0) {
        await prisma.guest.delete({ where: { id: dupe.guest.id } }).catch(() => {});
      }
      results.push({ removed: dupe.id, revokedCodes: revoke.revoked, lockErrors: revoke.lockErrors });
    }
  }

  return NextResponse.json({ applied: true, groupsProcessed: duplicateGroups.length, results });
}
