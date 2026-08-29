import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";
import { readRatePlansFromChannel } from "@/lib/channels/channex-channel-read";

// Reads the rooms and rates a CHANNEL exposes, straight from the channel.
//
// The question this answers: can host24 read a host's real Booking.com rate
// plans without a screenshot, without a saved page, and without touching their
// extranet login? Channex documents POST /channels/mapping_details as "the
// rooms and rates the channel exposes for the given credentials", taking the
// same body as a test connection and creating nothing - so it is a read
// despite the verb.
//
// The settings are not typed here. They are read back off the existing channel
// connection, so this uses whatever that channel actually needs rather than a
// guess at its shape - which differs per adapter.
//
// Two modes:
//
//   ?channelId=<uuid>    the raw payload for one known connection
//   ?propertyId=<id>     the whole path the real endpoint takes - find the
//                        property's connection, read its settings, call
//                        mapping_details, turn the answer into a proposal
//
// The second calls readRatePlansFromChannel, the same function
// /api/channex/rate-plans/read-from-channel calls, rather than a copy of it.
// A probe that reimplements what it is vouching for can pass while the real
// endpoint fails, which is worse than having no probe.
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const params = new URL(req.url).searchParams;

  const propertyId = params.get("propertyId");
  if (propertyId) {
    const listing = await prisma.channexListing.findUnique({
      where: { propertyId },
      select: { channexPropertyId: true, property: { select: { name: true } } },
    });
    if (!listing) {
      return NextResponse.json({ error: "That property has no Channex listing" }, { status: 404 });
    }
    const result = await readRatePlansFromChannel(listing.channexPropertyId);
    return NextResponse.json(
      { property: listing.property.name, channexPropertyId: listing.channexPropertyId, ...result },
      { status: result.ok ? 200 : result.status }
    );
  }

  const channelId = params.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "channelId or propertyId is required" }, { status: 400 });
  }

  let channel: string;
  let settings: Record<string, unknown>;
  try {
    const res = await channexGet<{ attributes?: { channel?: string; settings?: Record<string, unknown> } }>(
      `/channels/${channelId}`
    );
    channel = res.data?.attributes?.channel ?? "";
    settings = res.data?.attributes?.settings ?? {};
    if (!channel) return NextResponse.json({ error: "That channel has no adapter code" }, { status: 404 });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ step: "read channel", error: e.message, details: e.details }, { status: 502 });
  }

  try {
    const res = await channexPost<unknown>("/channels/mapping_details", { channel, settings });
    return NextResponse.json({
      channel,
      sentSettingsKeys: Object.keys(settings),
      mappingDetails: res.data,
    });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json(
      { channel, step: "mapping_details", error: e.message, status: e.status, details: e.details },
      { status: 502 }
    );
  }
}
