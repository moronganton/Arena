import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { getHotelPolicyForProperty, upsertHotelPolicy } from "@/lib/channels/channex-hotel-policy";
import { getPropertyFacilityIds, listFacilityOptions } from "@/lib/channels/channex-facilities";
import { ChannexError } from "@/lib/channels/channex-core";

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
  const applyPolicy = new URL(req.url).searchParams.get("applyPolicy") === "true";

  try {
    const existing = await getHotelPolicyForProperty(channexPropertyId);
    if (existing || !applyPolicy) {
      results.hotelPolicy = existing;
    } else {
      // Real write-path verification: creates one genuine, sensible policy
      // rather than throwaway test data, since Sinteu doesn't have one yet.
      results.hotelPolicy = await upsertHotelPolicy(channexPropertyId, {
        title: "Sinteu 3 bedroom apartment - 2PAX",
        currency: "EUR",
        is_adults_only: false,
        max_count_of_guests: 6,
        checkin_from_time: "15:00",
        checkin_to_time: "22:00",
        checkout_from_time: "08:00",
        checkout_to_time: "11:00",
        internet_access_type: "wifi",
        internet_access_coverage: "entire_property",
        internet_access_cost: null,
        parking_type: "none",
        parking_reservation: "not_available",
        parking_is_private: false,
        pets_policy: "not_allowed",
        pets_non_refundable_fee: "0.00",
        pets_refundable_deposit: "0.00",
        smoking_policy: "no_smoking",
      });
      results.hotelPolicyCreated = true;
    }
  } catch (err) {
    const e = err as ChannexError;
    results.hotelPolicyError = { message: e.message, details: e.details };
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
