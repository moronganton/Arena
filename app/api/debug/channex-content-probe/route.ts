import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { getHotelPolicyForProperty } from "@/lib/channels/channex-hotel-policy";
import { getPropertyFacilityIds, listFacilityOptions } from "@/lib/channels/channex-facilities";

// One-off verification for the two assumptions in this batch that weren't
// backed by a concrete doc example: whether hotel_policies list attributes
// carry property_id, and whether GET /properties/:id really returns a
// `facilities` array the way Update Property's docs imply it accepts one.
// The real feature routes (app/api/channex/hotel-policy,
// app/api/channex/facilities) are session-gated like every other real
// product route in this app, so this is the only way to exercise them with
// just the debug secret.
//
//   GET /api/debug/channex-content-probe
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const property = await prisma.property.findFirst({
    where: { ownerId: access.userId, channelProvider: "CHANNEX" },
    select: { name: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property?.channexListing) return NextResponse.json({ error: "No Channex property found" }, { status: 404 });
  const channexPropertyId = property.channexListing.channexPropertyId;

  const results: Record<string, unknown> = { property: property.name, channexPropertyId };

  try {
    results.hotelPolicy = await getHotelPolicyForProperty(channexPropertyId);
  } catch (err) {
    results.hotelPolicyError = err instanceof Error ? err.message : String(err);
  }

  try {
    const [ids, options] = await Promise.all([getPropertyFacilityIds(channexPropertyId), listFacilityOptions()]);
    results.facilityIds = ids;
    results.facilityOptionsCount = options.length;
  } catch (err) {
    results.facilitiesError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results);
}
