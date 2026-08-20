import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Flips a property's channelProvider from SMOOBU to CHANNEX and removes its
// Smoobu mapping (ChannelConfig channel="SMOOBU"), in one confirmed step.
//
// This is the real switch task #11 depends on: enqueueAriUpdate and the
// upcoming webhook->reservation logic both gate on channelProvider ===
// CHANNEX, so a property stays fully inert on the Channex side until this
// runs, no matter what's connected in Channex's own dashboard.
//
// Requires a ChannexListing to already exist (provisioned in step 4) - a
// property with no ChannexListing has nothing on the Channex side to
// activate, so flipping the flag would just silently do nothing useful.
//
//   GET /api/debug/migrate-to-channex?propertyId=<id>            -> dry run
//   GET /api/debug/migrate-to-channex?propertyId=<id>&confirm=true -> applies
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const confirm = searchParams.get("confirm") === "true";

  if (!propertyId) {
    const candidates = await prisma.property.findMany({
      where: { ownerId: session.user.id },
      select: { id: true, name: true, channelProvider: true, channexListing: { select: { id: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      hint: "Pass ?propertyId=<id> for one of these, then &confirm=true to apply.",
      properties: candidates,
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    include: {
      channexListing: true,
      channels: { where: { channel: "SMOOBU" } },
    },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  if (!property.channexListing) {
    return NextResponse.json(
      { error: "No ChannexListing for this property - nothing to activate on the Channex side yet." },
      { status: 400 }
    );
  }

  const plan = {
    property: property.name,
    currentChannelProvider: property.channelProvider,
    willSetChannelProviderTo: "CHANNEX",
    smoobuMappingToRemove: property.channels[0] ?? null,
  };

  if (!confirm) {
    return NextResponse.json({ mode: "dry run - nothing changed", plan });
  }

  const [updatedProperty] = await prisma.$transaction([
    prisma.property.update({
      where: { id: property.id },
      data: { channelProvider: "CHANNEX" },
      select: { id: true, name: true, channelProvider: true },
    }),
    prisma.channelConfig.deleteMany({ where: { propertyId: property.id, channel: "SMOOBU" } }),
  ]);

  return NextResponse.json({ applied: true, property: updatedProperty, smoobuMappingRemoved: property.channels.length > 0 });
}
