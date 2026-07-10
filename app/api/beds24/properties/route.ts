import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listBeds24Properties } from "@/lib/channels/beds24";

// GET — Beds24 properties + current mappings
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [beds24Properties, stayhqProperties, mappings] = await Promise.all([
      listBeds24Properties(session.user.id),
      prisma.property.findMany({
        where: { ownerId: session.user.id, active: true },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.channelConfig.findMany({
        where: { channel: "BEDS24", property: { ownerId: session.user.id } },
        select: { propertyId: true, listingId: true },
      }),
    ]);

    return NextResponse.json({ beds24Properties, stayhqProperties, mappings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load properties" },
      { status: 500 }
    );
  }
}

// POST — save mappings: [{ propertyId, beds24PropertyId | "" }]
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { mappings } = await req.json();
  if (!Array.isArray(mappings)) {
    return NextResponse.json({ error: "mappings array required" }, { status: 400 });
  }

  for (const m of mappings) {
    const property = await prisma.property.findFirst({
      where: { id: m.propertyId, ownerId: session.user.id },
    });
    if (!property) continue;

    if (m.beds24PropertyId) {
      await prisma.channelConfig.upsert({
        where: { propertyId_channel: { propertyId: m.propertyId, channel: "BEDS24" } },
        create: {
          propertyId: m.propertyId,
          channel: "BEDS24",
          listingId: String(m.beds24PropertyId),
          isActive: true,
        },
        update: { listingId: String(m.beds24PropertyId), isActive: true },
      });
    } else {
      await prisma.channelConfig.deleteMany({
        where: { propertyId: m.propertyId, channel: "BEDS24" },
      });
    }
  }

  return NextResponse.json({ success: true });
}
