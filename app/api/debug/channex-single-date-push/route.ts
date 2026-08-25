import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { pushAriForDateRange } from "@/lib/channels/channex-ari";

// Certification test 2, "Single Date Update for Single Rate": push exactly
// one night's availability, rate and restriction and hand back the task IDs
// Channex returns, which the form asks for as proof.
//
// The everyday path (a pricing override enqueues an AriOutbox row, drain-ari
// pushes it on its own schedule) already does single-date pushes correctly -
// that's how the app behaves in normal use. It just never surfaces the
// resulting task ID anywhere, because nothing before this needed to show one
// to a human. This route calls the same pushAriForDateRange the drain uses,
// synchronously, so the certification evidence is real output from the real
// push path, not a separate one built just to look right on a form.
//
//   GET /api/debug/channex-single-date-push                                (no params: lists candidates)
//   GET /api/debug/channex-single-date-push?propertyId=xxx&date=2026-09-15  (dry run - no Channex call)
//   GET /api/debug/channex-single-date-push?propertyId=xxx&date=2026-09-15&apply=true

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const dateParam = searchParams.get("date");
  const apply = searchParams.get("apply") === "true";

  if (!propertyId) {
    const properties = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX" },
      select: { id: true, name: true, channexListing: { select: { channexPropertyId: true } } },
    });
    return NextResponse.json({
      properties: properties.map((p) => ({
        id: p.id,
        name: p.name,
        provisioned: !!p.channexListing,
      })),
      nextStep: "Add ?propertyId=xxx&date=YYYY-MM-DD to target one.",
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: access.userId },
    include: { channexListing: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (!property.channexListing) {
    return NextResponse.json({ error: `${property.name} isn't provisioned on Channex yet` }, { status: 400 });
  }

  if (!dateParam) {
    return NextResponse.json({ error: "Add &date=YYYY-MM-DD - a single night to push" }, { status: 400 });
  }
  const dateFrom = new Date(`${dateParam}T00:00:00.000Z`);
  if (Number.isNaN(dateFrom.getTime())) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const dateTo = new Date(dateFrom.getTime() + 86400000); // exactly one night

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      property: property.name,
      night: dateParam,
      nextStep: "Add &apply=true to actually push this one night and get the task IDs.",
    });
  }

  const taskIds = await pushAriForDateRange(property.id, dateFrom, dateTo);
  return NextResponse.json({
    property: property.name,
    night: dateParam,
    taskIds,
    note: "These are the same task IDs Channex would return for any single-date push - this route just surfaces them instead of discarding them the way the everyday drain path does.",
  });
}
