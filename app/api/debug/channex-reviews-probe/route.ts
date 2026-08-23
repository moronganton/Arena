import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { listReviewsForProperty, isReviewsAppNotInstalled } from "@/lib/channels/channex-reviews";
import { ChannexError } from "@/lib/channels/channex-core";

// Reviews (lib/channels/channex-reviews.ts, /api/channex/reviews) was built
// against the real Channex docs but never exercised live - the route itself
// requires a browser session, so this is the debug-secret equivalent for a
// one-off check from here.
//
//   GET /api/debug/channex-reviews-probe
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const property = await prisma.property.findFirst({
    where: { ownerId: access.userId, channelProvider: "CHANNEX" },
    select: { name: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property?.channexListing) return NextResponse.json({ error: "No Channex property found" }, { status: 404 });

  try {
    const reviews = await listReviewsForProperty(property.channexListing.channexPropertyId);
    return NextResponse.json({ property: property.name, count: reviews.length, reviews });
  } catch (err) {
    if (isReviewsAppNotInstalled(err)) {
      return NextResponse.json({ property: property.name, appInstalled: false, error: "Messages & Reviews app isn't installed for this property" });
    }
    const e = err as ChannexError;
    return NextResponse.json({ property: property.name, error: e.message, status: e.status, details: e.details }, { status: 500 });
  }
}
