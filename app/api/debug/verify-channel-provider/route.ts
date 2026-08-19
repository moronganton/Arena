import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Confirms step 3's exit criteria from the Channex build plan (every
// property shows channelProvider = SMOOBU), and - added for step 6 - shows
// which properties are ALREADY mapped to Smoobu alongside their Channex
// listing.
//
// That overlap is the plan's one hard constraint: two channel managers must
// never own the same OTA listing at once, or they fight over availability
// and can cause a real overbooking. A property with both a live Smoobu
// mapping and a Channex listing is safe only while nothing has connected an
// OTA channel to the Channex side - which is exactly the state to verify
// BEFORE connecting one.
//
//   GET /api/debug/verify-channel-provider
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const properties = await prisma.property.findMany({
    where: { ownerId: session.user.id },
    select: {
      id: true,
      name: true,
      channelProvider: true,
      channexListing: { select: { channexPropertyId: true, channexRoomTypeId: true, channexRatePlanId: true } },
      channels: { select: { channel: true, listingId: true, isActive: true } },
      _count: { select: { reservations: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = properties.map((p) => {
    const smoobuMappings = p.channels.filter((c) => c.channel === "SMOOBU" && c.listingId);
    return {
      name: p.name,
      channelProvider: p.channelProvider,
      hasChannexListing: p.channexListing !== null,
      channexListing: p.channexListing,
      channelConfigs: p.channels,
      smoobuMapped: smoobuMappings.length > 0,
      reservations: p._count.reservations,
      dualManagerRisk:
        smoobuMappings.length > 0 && p.channexListing !== null
          ? "BOTH Smoobu-mapped AND provisioned on Channex. Safe only while no OTA channel is connected on the Channex side - connecting one would put two channel managers on the same listing."
          : null,
    };
  });

  return NextResponse.json({
    allSmoobu: properties.every((p) => p.channelProvider === "SMOOBU"),
    propertiesAtDualManagerRisk: rows.filter((r) => r.dualManagerRisk).map((r) => r.name),
    properties: rows,
  });
}
