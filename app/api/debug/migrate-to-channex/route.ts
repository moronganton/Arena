import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
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
// Channels that represent a channel MANAGER owning the listing, as opposed to
// an OTA reached through one. Only these are mutually exclusive with Channex.
const MANAGER_CHANNELS = ["SMOOBU", "BEDS24"];

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const confirm = searchParams.get("confirm") === "true";

  if (!propertyId) {
    const candidates = await prisma.property.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, channelProvider: true, channexListing: { select: { id: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      hint: "Pass ?propertyId=<id> for one of these, then &confirm=true to apply.",
      properties: candidates,
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: userId },
    include: {
      channexListing: true,
      channels: { where: { channel: { in: MANAGER_CHANNELS } } },
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
    managerMappingsToRemove: property.channels,
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
    // Every OTHER channel manager, not just Smoobu. Sinteu still carried a
    // dead Beds24 mapping after its migration, which left the property page
    // reporting Beds24 as its connected channel long after Channex had taken
    // over. Two managers on one listing is the exact overlap this flag exists
    // to prevent, so none may survive the switch.
    prisma.channelConfig.deleteMany({
      where: { propertyId: property.id, channel: { in: MANAGER_CHANNELS } },
    }),
  ]);

  return NextResponse.json({ applied: true, property: updatedProperty, managerMappingsRemoved: property.channels.map((c) => c.channel) });
}
