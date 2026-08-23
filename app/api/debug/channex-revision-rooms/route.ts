import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { fetchChannexRevision } from "@/lib/channels/channex-bookings";

// Full room-level mapping detail for one revision, side by side with what
// this account's ChannexListing actually has stored - the generic
// channex-probe route truncates bodies at ~1500 chars, which cuts off the
// rooms[] array before the fields that actually matter here.
//
//   GET /api/debug/channex-revision-rooms?revisionId=...
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const revisionId = new URL(req.url).searchParams.get("revisionId");
  if (!revisionId) return NextResponse.json({ error: "revisionId is required" }, { status: 400 });

  const attrs = await fetchChannexRevision(revisionId);

  const listings = await prisma.channexListing.findMany({
    where: { property: { ownerId: access.userId } },
    select: { channexPropertyId: true, channexRoomTypeId: true, channexRatePlanId: true, property: { select: { name: true } } },
  });

  return NextResponse.json({
    bookingId: attrs.booking_id,
    status: attrs.status,
    propertyId: attrs.property_id,
    rooms: attrs.rooms.map((r) => ({
      booking_room_id: r.booking_room_id,
      room_type_id: r.room_type_id,
      rate_plan_id: r.rate_plan_id,
      meta: r.meta,
      is_cancelled: r.is_cancelled,
    })),
    knownListings: listings,
  });
}
