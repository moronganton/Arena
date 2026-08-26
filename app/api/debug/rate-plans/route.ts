import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { provisionRatePlanSet, deleteRatePlan } from "@/lib/channels/channex-rate-plans";

// The same provisioning as /api/channex/rate-plans, reachable with a debug
// secret instead of a browser session.
//
// That route is a POST behind session auth, which means it can only be driven
// by a human with a logged-in browser - fine for the app, useless for driving
// the setup from a script or an agent. This is the same pattern the other
// debug routes here already use, and it goes through requireChannexProperty
// exactly as the real route does, so a Smoobu property is no more reachable
// from here than from there.
//
// propertyId is optional: with one Channex property in the database - which is
// the whole point of this staging environment - there is nothing to choose
// between. It refuses rather than guesses if there is more than one.
//
//   GET /api/debug/rate-plans                    - dry run, shows the JSON
//   GET /api/debug/rate-plans?apply=true         - create them on Channex
//   GET /api/debug/rate-plans?deleteRatePlanId=  - remove a replaced plan

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "true";
  const retireExisting = searchParams.get("retireExisting") === "true";
  const deleteRatePlanId = searchParams.get("deleteRatePlanId");

  let propertyId = searchParams.get("propertyId");
  if (!propertyId) {
    const candidates = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX", channexListing: { isNot: null } },
      select: { id: true, name: true },
    });
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No Channex-provisioned property for this user" }, { status: 404 });
    }
    if (candidates.length > 1) {
      return NextResponse.json(
        { error: "More than one Channex property - pass ?propertyId=", candidates },
        { status: 400 }
      );
    }
    propertyId = candidates[0].id;
  }

  const guard = await requireChannexProperty(propertyId, access.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (deleteRatePlanId) {
    const res = await deleteRatePlan(guard.channexListingId, deleteRatePlanId);
    return NextResponse.json(
      { property: guard.propertyName, deleted: res.ok ? deleteRatePlanId : null, error: res.error, details: res.details },
      { status: res.ok ? 200 : 409 }
    );
  }

  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { currency: true, maxGuests: true },
  });

  const result = await provisionRatePlanSet({
    channexListingId: guard.channexListingId,
    propertyId,
    propertyName: guard.propertyName,
    channexPropertyId: guard.channexPropertyId,
    channexRoomTypeId: guard.channexRoomTypeId,
    currency: property.currency,
    occupancy: property.maxGuests,
    currentChannexRatePlanId: guard.channexRatePlanId,
    apply,
    retireExisting,
  });

  if (result.problems.length > 0) {
    return NextResponse.json({ status: "rejected", problems: result.problems }, { status: 400 });
  }

  // Three outcomes, not two. Reporting a FAILED apply as "dry run - nothing
  // was created" reads as "you only previewed it" when what actually happened
  // is a write that was rejected - and on a partial failure some plans exist.
  const status = result.applied
    ? "created"
    : apply
      ? "FAILED - see steps"
      : "dry run - nothing was created on Channex";

  return NextResponse.json({
    status,
    ...result,
    nextStep: result.applied
      ? `Confirm prices land on ${result.parentChannexRatePlanId} after the next drain-ari cycle, then call with ?deleteRatePlanId=${result.previousParentChannexRatePlanId} to remove the old plan.`
      : "Add &apply=true to create these on Channex.",
  });
}
