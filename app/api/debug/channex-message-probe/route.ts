import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";

// Discovers Channex's outbound message-send shape, the same read-only-first
// discovery pattern used for bookings and webhooks. GET /message_threads and
// GET /message_threads/{id}/messages are confirmed working (200, real data) -
// this only differs by finally attempting a POST, which is the one thing not
// yet tried for messaging.
//
// Channex's own dashboard showed "We couldn't load this right now" on the
// same thread this reads from just now, which is why this goes straight to
// the API rather than relying on their UI being up.
//
//   GET /api/debug/channex-message-probe                 -> dry run, shows the thread + candidate payload
//   GET /api/debug/channex-message-probe?send=true         -> actually sends a test message
const JORGE_SANCHEZ_BOOKING_ID = "e7b956c4-c89a-4627-8dd7-333f812032d3";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const send = new URL(req.url).searchParams.get("send") === "true";

  let thread: { id: string; attributes: Record<string, unknown> } | null = null;
  try {
    const res = await channexGet<Array<{ id: string; attributes: Record<string, unknown>; relationships?: { booking?: { data?: { id: string } } } }>>(
      "/message_threads"
    );
    thread = (res.data ?? []).find((t) => t.relationships?.booking?.data?.id === JORGE_SANCHEZ_BOOKING_ID) ?? null;
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: "Failed to list message_threads", message: e.message, status: e.status }, { status: 500 });
  }

  if (!thread) {
    return NextResponse.json({ error: "Jorge Sanchez's message thread not found - has it changed?" }, { status: 404 });
  }

  // Mirrors the singular-wrapper-key convention every other Channex write
  // used (webhook: {...}, booking: {...}) and the field name the read shape
  // itself uses (attributes.message on each message resource).
  const candidatePayload = { message: { message: `StayHQ test message ${new Date().toISOString()}` } };

  if (!send) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      threadId: thread.id,
      threadAttributes: thread.attributes,
      candidatePayload,
      nextStep: "Add ?send=true to actually send this.",
    });
  }

  try {
    const res = await channexPost(`/message_threads/${thread.id}/messages`, candidatePayload);
    return NextResponse.json({ status: "ok", threadId: thread.id, payload: candidatePayload, response: res.data });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({
      status: "failed",
      threadId: thread.id,
      payload: candidatePayload,
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
  }
}
