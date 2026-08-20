import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { fetchBookingMessages, sendBookingMessage } from "@/lib/channels/channex-messages";
import { ChannexError } from "@/lib/channels/channex-core";

// Tests the real, docs-confirmed booking-level messaging endpoint directly:
// GET/POST /bookings/:booking_id/messages. Deliberately booking-scoped, not
// thread-scoped - the message THREAD found earlier expired within minutes on
// this shared sandbox account, but the underlying BOOKING is still real (it's
// a live Reservation in our own database), so this sidesteps that volatility
// entirely.
//
//   GET /api/debug/channex-message-probe          -> dry run, reads existing messages
//   GET /api/debug/channex-message-probe?send=true -> also sends a test message
const JORGE_SANCHEZ_BOOKING_ID = "e7b956c4-c89a-4627-8dd7-333f812032d3";

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const send = new URL(req.url).searchParams.get("send") === "true";

  let existingMessages: unknown;
  try {
    existingMessages = await fetchBookingMessages(JORGE_SANCHEZ_BOOKING_ID);
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: "Failed to read messages", message: e.message, status: e.status }, { status: 500 });
  }

  if (!send) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      bookingId: JORGE_SANCHEZ_BOOKING_ID,
      existingMessages,
      nextStep: "Add ?send=true to actually send a test message.",
    });
  }

  try {
    const sent = await sendBookingMessage(JORGE_SANCHEZ_BOOKING_ID, `StayHQ test message ${new Date().toISOString()}`);
    return NextResponse.json({ status: "ok", bookingId: JORGE_SANCHEZ_BOOKING_ID, sent, existingMessages });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({
      status: "failed",
      bookingId: JORGE_SANCHEZ_BOOKING_ID,
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
      existingMessages,
    });
  }
}
