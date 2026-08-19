import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Confirms step 3's exit criteria from the Channex build plan: every
// existing property should show channelProvider = SMOOBU after the schema
// change deploys, with no ChannexListing rows yet (nothing has been
// provisioned - that's a later step).
//   GET /api/debug/verify-channel-provider
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const properties = await prisma.property.findMany({
    where: { ownerId: session.user.id },
    select: {
      name: true,
      channelProvider: true,
      channexListing: { select: { channexPropertyId: true, channexRoomTypeId: true, channexRatePlanId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    allSmoobu: properties.every((p) => p.channelProvider === "SMOOBU"),
    noChannexListingsYet: properties.every((p) => p.channexListing === null),
    properties,
  });
}
