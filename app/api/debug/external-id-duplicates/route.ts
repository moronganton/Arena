import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// Pre-flight for putting a uniqueness constraint on Reservation.externalId.
//
// That constraint is the safeguard the duplicate-reservation episode argued
// for: the second insert would have failed loudly at the database instead of
// quietly producing a second reservation and a second door code on a real
// lock. But adding it to a table that already holds a duplicate makes the
// migration fail on deploy, which on this app means a failed boot - so the
// data has to be checked first, across every owner rather than just one.
//
// Nulls are not a problem: Postgres permits any number of them in a unique
// index, so direct bookings with no external reference are unaffected.
//
//   GET /api/debug/external-id-duplicates
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const grouped = await prisma.reservation.groupBy({
    by: ["externalId"],
    where: { externalId: { not: null } },
    _count: { _all: true },
    having: { externalId: { _count: { gt: 1 } } },
  });

  const details = await Promise.all(
    grouped.map(async (g) => {
      const rows = await prisma.reservation.findMany({
        where: { externalId: g.externalId },
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          status: true,
          createdAt: true,
          guest: { select: { name: true } },
          property: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return { externalId: g.externalId, count: g._count._all, rows };
    })
  );

  const [total, withExternalId] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { externalId: { not: null } } }),
  ]);

  return NextResponse.json({
    reservationsTotal: total,
    withExternalId,
    withoutExternalId: total - withExternalId,
    duplicateGroups: details.length,
    safeToAddUniqueConstraint: details.length === 0,
    duplicates: details,
  });
}
