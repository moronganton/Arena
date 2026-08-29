import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";

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
//   GET /api/debug/channex-mapping-details?channelId=<uuid>
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const channelId = new URL(req.url).searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });

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
