import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexPost, channexAppOrigin, ChannexError } from "@/lib/channels/channex-core";

// Diagnostic for the embedded channel-mapping UI (/api/channex/iframe-token,
// surfaced as "Manage channels" on the Channels page). That route is session-
// authenticated, so it can't be exercised with a debug secret - this hits the
// same Channex endpoint behind it and reports exactly what came back.
//
// The specific question this answers: whether POST /auth/one_time_token is
// permitted for this account at all. Channex gates some endpoints behind
// applications installed on their side - GET /message_threads returned 403
// until the Messages app was installed - so a 403 here means a Channex
// account setting to change, not a bug in the embed.
//
//   GET /api/debug/channex-iframe-token
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const property = await prisma.property.findFirst({
    where: { ownerId: access.userId, channelProvider: "CHANNEX", channexListing: { isNot: null } },
    select: { name: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property?.channexListing) {
    return NextResponse.json({ error: "No provisioned Channex property for this user" }, { status: 404 });
  }

  const channexPropertyId = property.channexListing.channexPropertyId;

  try {
    const res = await channexPost<{ token?: string }>("/auth/one_time_token", {
      one_time_token: { property_id: channexPropertyId, username: "StayHQ debug" },
    });
    const token = res.data?.token;
    if (!token) {
      return NextResponse.json({ status: "no token in response", raw: res }, { status: 502 });
    }
    return NextResponse.json({
      status: "ok",
      property: property.name,
      // Single-use and valid 15 minutes - paste into a browser to confirm the
      // embedded page actually renders, which the API call alone can't prove.
      url:
        `${channexAppOrigin()}/auth/exchange` +
        `?oauth_session_key=${encodeURIComponent(token)}` +
        `&app_mode=headless&redirect_to=/channels&property_id=${encodeURIComponent(channexPropertyId)}`,
    });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({
      status: "failed",
      property: property.name,
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
      hint:
        e.status === 403
          ? "403 usually means this endpoint isn't enabled for the account - ask Channex to enable the iframe/embedded UI, same as the Messages app was needed for message threads."
          : undefined,
    });
  }
}
