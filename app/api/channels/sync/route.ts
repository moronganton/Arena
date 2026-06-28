import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncChannelIcal, syncAllChannels } from "@/lib/channels/ical";
import { z } from "zod";

const upsertSchema = z.object({
  propertyId: z.string(),
  channel: z.enum(["BOOKING", "AIRBNB", "VRBO", "EXPEDIA"]),
  icalUrl: z.string().url().optional(),
  listingId: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const channels = await prisma.channelConfig.findMany({
    where: { property: { ownerId: session!.user!.id } },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(channels);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // If this is a "sync all" request
  if (body.action === "sync_all") {
    await syncAllChannels();
    return NextResponse.json({ success: true, message: "All channels synced" });
  }

  // If this is a single channel sync
  if (body.channelId) {
    const channel = await prisma.channelConfig.findFirst({
      where: { id: body.channelId, property: { ownerId: session!.user!.id } },
    });
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const result = await syncChannelIcal(body.channelId);
    return NextResponse.json(result);
  }

  // Otherwise, create or update a channel config
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: parsed.data.propertyId, ownerId: session!.user!.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const config = await prisma.channelConfig.upsert({
    where: {
      propertyId_channel: {
        propertyId: parsed.data.propertyId,
        channel: parsed.data.channel,
      },
    },
    create: parsed.data,
    update: parsed.data,
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(config, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const channel = await prisma.channelConfig.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.channelConfig.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
