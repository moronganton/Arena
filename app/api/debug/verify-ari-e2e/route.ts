import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { drainAriOutbox } from "@/lib/channels/ari-drain";
import { channexGet, ChannexError } from "@/lib/channels/channex-core";

// The plan's own exit criterion for step 5, run against a real listing:
// "Block a date in StayHQ -> outbox row appears -> drains -> read ARI back
// from Channex and confirm the date is closed."
//
// Runs against Sinteu specifically, using a 2027 date far from any real
// booking, WITHOUT touching Property.channelProvider - that flag is
// deliberately left for step 9, and flipping it now would change how every
// other part of the app treats a property that still has a live Smoobu
// account. The normal enqueue hooks (app/api/calendar/route.ts, etc.) are
// gated on channelProvider = CHANNEX for exactly that reason, so this
// endpoint enqueues the AriOutbox row directly - a deliberate, one-time,
// clearly-commented bypass of that gate for verification only, not a
// pattern used anywhere real code follows.
//
//   GET /api/debug/verify-ari-e2e
const TEST_DATE = "2027-08-10";

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

  const dateFrom = new Date(`${TEST_DATE}T00:00:00Z`);
  const dateTo = new Date(dateFrom.getTime() + 86400000); // one night, exclusive end

  // Step 1: "Block a date in StayHQ" - a real CalendarBlock, same as the
  // Calendar tab would create. Reused if this endpoint has already run.
  let block = await prisma.calendarBlock.findFirst({
    where: { propertyId: property.id, startDate: dateFrom, endDate: dateTo },
  });
  if (!block) {
    block = await prisma.calendarBlock.create({
      data: { propertyId: property.id, startDate: dateFrom, endDate: dateTo, reason: "step 5 e2e verification" },
    });
  }

  // Step 2: "outbox row appears" - the bypass described above.
  const outboxRow = await prisma.ariOutbox.create({
    data: { propertyId: property.id, dateFrom, dateTo, kind: "AVAILABILITY", status: "PENDING" },
  });

  // Step 3: "drains" - the real worker, called directly rather than via the
  // fire-and-forget cron route, so this response can report what happened
  // instead of returning before the push completes.
  const drainSummary = await drainAriOutbox();

  const afterDrain = await prisma.ariOutbox.findUnique({ where: { id: outboxRow.id } });

  // Step 4: "read ARI back from Channex and confirm the date is closed" -
  // the confirmed contract from the probe.
  let readback: unknown = null;
  try {
    const res = await channexGet(
      `/availability?filter%5Bproperty_id%5D=${listing.channexPropertyId}&filter%5Broom_type_id%5D=${listing.channexRoomTypeId}&filter%5Bdate%5D=${TEST_DATE}`
    );
    readback = { status: "ok", response: res.data };
  } catch (err) {
    const e = err as ChannexError;
    readback = { status: "failed", error: { message: e.message, status: e.status, code: e.code, details: e.details } };
  }

  const availabilityValue = (readback as { response?: Record<string, Record<string, number>> })?.response?.[
    listing.channexRoomTypeId
  ]?.[TEST_DATE];

  return NextResponse.json({
    property: property.name,
    testDate: TEST_DATE,
    step1_calendarBlockInStayHQ: { id: block.id, startDate: block.startDate, endDate: block.endDate },
    step2_outboxRowStatus: outboxRow.status,
    step3_drainSummary: drainSummary,
    step3_outboxRowAfterDrain: afterDrain ? { status: afterDrain.status, attempts: afterDrain.attempts, lastError: afterDrain.lastError } : null,
    step4_channexReadback: readback,
    verdict:
      afterDrain?.status === "DONE" && availabilityValue === 0
        ? "CONFIRMED: blocked in StayHQ, drained, and Channex shows availability 0 for this date."
        : "NOT CONFIRMED - see the steps above for where it diverged.",
  });
}
