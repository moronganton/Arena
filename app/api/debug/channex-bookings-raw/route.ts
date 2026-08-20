import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, ChannexError } from "@/lib/channels/channex-core";

// Dumps the full, untruncated booking payload shape from Channex - the
// channex-probe endpoint's excerpt is capped at 1200 chars, too short to see
// the complete customer/rooms/occupancy structure needed to build the real
// reservation-upsert logic for task #11.
//
// Also resolves each booking's property_id against our own ChannexListing
// rows, since that's the join the upsert logic will actually need: a
// booking with no matching ChannexListing has nothing in StayHQ to attach
// to and must be skipped, not guessed at.
//
//   GET /api/debug/channex-bookings-raw
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  let bookings: unknown[] = [];
  try {
    const res = await channexGet<Array<{ attributes: Record<string, unknown> }>>("/bookings");
    bookings = (res.data ?? []).map((b) => b.attributes);
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, status: e.status, details: e.details }, { status: 500 });
  }

  const listings = await prisma.channexListing.findMany({
    include: { property: { select: { id: true, name: true } } },
  });

  const withResolution = bookings.map((b) => {
    const propertyId = (b as { property_id?: string }).property_id;
    const matchedListing = listings.find((l) => l.channexPropertyId === propertyId);
    return { booking: b, resolvesToProperty: matchedListing?.property.name ?? null };
  });

  return NextResponse.json({ count: bookings.length, listingsKnown: listings.length, bookings: withResolution });
}
