import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { runFullSyncForProperty } from "@/lib/channels/channex-ari";

// Triggers a full ARI resync for one Channex-managed property: certification
// test 1, "Full Data Update (Full Sync)".
//
// Channex's own description: "a full sync can be initiated at any time to
// recover from downtimes, errors or other events... Full sync means you
// should send 500 days of Availability, rates and restrictions for all
// rooms and rates on the property." The everyday path here is the AriOutbox
// queue, which only ever covers the range a change actually touched and
// only fires from a change - there was no way to ask for the whole 500-day
// window on demand, which is the exact scenario ("recover from downtimes")
// this test exists to prove.
//
// The real reachable-from-the-app version of this trigger is
// /api/channex/full-sync (session-authenticated, a button on the Channels
// settings page) - use that for the certification screenshare itself.
// This debug route stays for inspecting per-chunk detail while testing,
// and both call the same runFullSyncForProperty, so there is exactly one
// implementation of what a full sync actually does.
//
//   GET /api/debug/channex-full-sync                    (no propertyId: lists candidates)
//   GET /api/debug/channex-full-sync?propertyId=xxx      (dry run - no Channex call)
//   GET /api/debug/channex-full-sync?propertyId=xxx&apply=true

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const apply = searchParams.get("apply") === "true";

  if (!propertyId) {
    const properties = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX" },
      select: { id: true, name: true, channexListing: { select: { channexPropertyId: true } } },
    });
    return NextResponse.json({
      error: "propertyId is required - pick one below and re-run",
      properties: properties.map((p) => ({
        propertyId: p.id,
        name: p.name,
        provisioned: !!p.channexListing,
      })),
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: access.userId },
    select: { id: true, name: true, channelProvider: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json(
      { error: `${property.name} has channelProvider=${property.channelProvider}, not CHANNEX - nothing to sync` },
      { status: 400 }
    );
  }
  if (!property.channexListing) {
    return NextResponse.json({ error: `${property.name} has no ChannexListing - run /api/channex/provision first` }, { status: 400 });
  }

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - no call made to Channex",
      property: property.name,
      horizonDays: 500,
      hint: "Re-run with &apply=true to actually push. Each call is throttled to stay under Channex's rate limit.",
    });
  }

  const result = await runFullSyncForProperty(property.id, property.name);

  return NextResponse.json({
    mode: "applied",
    property: property.name,
    channexPropertyId: property.channexListing.channexPropertyId,
    horizonDays: 500,
    callsFailed: result.callsFailed,
    // What certification asks to see attached as evidence of the sync.
    taskIds: result.taskIds,
  });
}
