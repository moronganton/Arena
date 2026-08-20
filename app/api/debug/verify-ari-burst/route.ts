import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { drainAriOutbox } from "@/lib/channels/ari-drain";

// The plan's other step 5 exit criterion, run for real: "Make 30 rapid
// changes -> confirm they coalesce and stay under the rate limit rather
// than firing 30 calls." mergeRanges() itself is already unit-tested with
// this exact scenario, but that only proves the merge function in
// isolation - this proves it at the level that actually matters: 30 real
// AriOutbox rows, one real drain run, and a call count pulled from what
// actually happened, not asserted against a mock.
//
// Uses a September 2027 window, separate from the October... August 10
// date the block/drain/readback verification used, so the two tests never
// interact. Rows are given slightly different sub-ranges within the
// window (not 30 identical copies) to mirror what a host dragging a
// pricing-rule date range around actually produces.
//
//   GET /api/debug/verify-ari-burst
const BASE_DATE = new Date("2027-09-01T00:00:00Z");
const WINDOW_NIGHTS = 5;
const EDIT_COUNT = 30;

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const property = await prisma.property.findFirst({
    where: { ownerId: userId, name: { startsWith: "Sinteu" } },
    select: { id: true, name: true },
  });
  if (!property) return NextResponse.json({ error: "Sinteu property not found" }, { status: 404 });

  const listing = await prisma.channexListing.findUnique({ where: { propertyId: property.id } });
  if (!listing) {
    return NextResponse.json({ error: "Sinteu has no ChannexListing - run /api/channex/provision first" }, { status: 404 });
  }

  // 30 overlapping rows within the same 5-night window - each one a
  // slightly different sub-range, the way 30 real edits to one pricing rule
  // or one calendar drag would land.
  const created = [];
  for (let i = 0; i < EDIT_COUNT; i++) {
    const from = new Date(BASE_DATE.getTime() + (i % 3) * 86400000);
    const to = new Date(BASE_DATE.getTime() + WINDOW_NIGHTS * 86400000 - (i % 2) * 86400000);
    const row = await prisma.ariOutbox.create({
      data: { propertyId: property.id, dateFrom: from, dateTo: to, kind: "RATE", status: "PENDING" },
    });
    created.push(row.id);
  }

  const summary = await drainAriOutbox();

  const rows = await prisma.ariOutbox.findMany({ where: { id: { in: created } } });
  const doneCount = rows.filter((r) => r.status === "DONE").length;

  return NextResponse.json({
    property: property.name,
    rowsCreated: EDIT_COUNT,
    drainSummary: summary,
    rowsMarkedDone: doneCount,
    verdict:
      summary.callsMade < EDIT_COUNT && doneCount === EDIT_COUNT
        ? `CONFIRMED: ${EDIT_COUNT} overlapping edits coalesced into ${summary.callsMade} Channex call(s), all ${EDIT_COUNT} rows settled.`
        : `NOT CONFIRMED: ${summary.callsMade} call(s) for ${EDIT_COUNT} rows, ${doneCount} settled - see drainSummary.`,
  });
}
