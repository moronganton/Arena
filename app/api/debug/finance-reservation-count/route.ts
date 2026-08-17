import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Answers "why does the finance report count N reservations for this month?"
// by listing the exact rows it counted, so a disagreement with a hand count is
// resolved against real data instead of reasoning about the query.
//
// Runs the SAME window and status filter as /api/finance/report, then adds the
// two things that could make the count differ from what a human counts:
//
//   1. duplicates - two rows for one real stay (same property + dates, or a
//      shared confirmation code). The bulk importer and the Smoobu sync use
//      different id schemes, so a stay imported AND synced appears twice.
//   2. boundary leakage - checkOut is expected to hold a calendar date pinned
//      to UTC midnight. A row holding a real CET instant instead (e.g.
//      2026-08-31T22:00:00Z, which is Sep 1 00:00 CEST) sits inside the August
//      window and inflates the month by one.
//
//   GET /api/debug/finance-reservation-count?month=2026-08
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  // Identical filter to the finance report.
  const counted = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: start, lt: end },
    },
    include: { guest: { select: { name: true } }, property: { select: { name: true } } },
    orderBy: { checkOut: "asc" },
  });

  const rows = counted.map((r) => ({
    guest: r.guest.name,
    property: r.property.name,
    checkIn: r.checkIn.toISOString().slice(0, 10),
    checkOut: r.checkOut.toISOString().slice(0, 10),
    // The raw instant - anything other than T00:00:00.000Z is a date stored as
    // a real timestamp, which is how a neighbouring month leaks in.
    checkOutRaw: r.checkOut.toISOString(),
    isMidnightUtc: r.checkOut.toISOString().endsWith("T00:00:00.000Z"),
    status: r.status,
    source: r.source,
    amount: r.totalAmount,
    confirmationCode: r.confirmationCode,
    externalId: r.externalId,
    createdAt: r.createdAt.toISOString(),
    bulkImported: (r.internalNotes || "").startsWith("Bulk-imported"),
  }));

  // Same property + same dates = almost certainly one stay stored twice.
  const byDates = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.property}|${r.checkIn}|${r.checkOut}`;
    if (!byDates.has(key)) byDates.set(key, []);
    byDates.get(key)!.push(r);
  }
  const duplicateDateGroups = Array.from(byDates.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, count: group.length, rows: group }));

  const byCode = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.confirmationCode) continue;
    const key = r.confirmationCode;
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key)!.push(r);
  }
  const duplicateCodeGroups = Array.from(byCode.entries())
    .filter(([, group]) => group.length > 1)
    .map(([code, group]) => ({ confirmationCode: code, count: group.length, rows: group }));

  const nonMidnight = rows.filter((r) => !r.isMidnightUtc);

  // Rows just outside the window, to see whether anything was pulled in or
  // pushed out by a couple of hours.
  const margin = 3 * 86400000;
  const neighbours = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      OR: [
        { checkOut: { gte: new Date(start.getTime() - margin), lt: start } },
        { checkOut: { gte: end, lt: new Date(end.getTime() + margin) } },
      ],
    },
    include: { guest: { select: { name: true } }, property: { select: { name: true } } },
    orderBy: { checkOut: "asc" },
  });

  // Cancelled/no-show rows in the window: what a hand count might include but
  // the report deliberately does not.
  const excludedByStatus = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      status: { in: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: start, lt: end },
    },
    include: { guest: { select: { name: true } } },
    orderBy: { checkOut: "asc" },
  });

  return NextResponse.json({
    month,
    window: { start: start.toISOString(), end: end.toISOString() },
    countedByReport: rows.length,
    findings: {
      duplicateDateGroups: duplicateDateGroups.length,
      duplicateCodeGroups: duplicateCodeGroups.length,
      checkOutsNotStoredAtUtcMidnight: nonMidnight.length,
      cancelledOrNoShowInWindow: excludedByStatus.length,
    },
    duplicateDateGroups,
    duplicateCodeGroups,
    nonMidnightCheckOuts: nonMidnight,
    countedRows: rows,
    justOutsideWindow: neighbours.map((r) => ({
      guest: r.guest.name,
      property: r.property.name,
      checkOut: r.checkOut.toISOString().slice(0, 10),
      checkOutRaw: r.checkOut.toISOString(),
      side: r.checkOut < start ? "before month" : "after month",
      status: r.status,
    })),
    excludedByStatus: excludedByStatus.map((r) => ({
      guest: r.guest.name,
      checkOut: r.checkOut.toISOString().slice(0, 10),
      status: r.status,
    })),
  });
}
