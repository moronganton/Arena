import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexPost, ChannexError } from "@/lib/channels/channex-core";

// Pre-flight for connecting an OTA, using Channex's own probe endpoint:
// "No channel connection is created or changed... Credentials the channel
// rejects, and a channel that cannot be reached, are reported as
// success: false in the response body rather than as an error."
//
// NOT usable for Booking.com, confirmed by running it: BDC returns
// {"success": false, "errors": "implementation_not_defined"}. That adapter
// implements no credential probe, which fits how the channel works - a
// Booking.com connection is authorised by the property in their extranet,
// so there are no credentials to test in the first place. For BDC the only
// way to find out is to create the connection.
//
// Still useful for adapters that DO take credentials (an access token, an
// account login), where it catches a bad value before a connection exists,
// and for the shared-code case Channex documents: "Channels that identify a
// property by a single code also require that code to be free: the test
// fails when another channel connection already uses it."
//
//   GET /api/debug/channex-test-channel?channel=BDC&hotel_id=4372137
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") || "BDC";
  const hotelId = searchParams.get("hotel_id");
  if (!hotelId) {
    return NextResponse.json(
      {
        error: "hotel_id is required",
        hint: "Channex's EUR Booking.com test property is 4372137; the GBP ones are 5868189 and 6519420. The currency must match the rate plan's, or mapping is impossible.",
      },
      { status: 400 }
    );
  }

  try {
    const res = await channexPost<{ success?: boolean; errors?: unknown }>("/channels/test_connection", {
      channel,
      settings: { hotel_id: hotelId },
    });
    return NextResponse.json({ channel, hotelId, result: res.data });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({
      channel,
      hotelId,
      status: "request failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
  }
}
