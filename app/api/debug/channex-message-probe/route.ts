import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { ChannexError } from "@/lib/channels/channex-core";
import {
  channexBookingIdFromExternalId,
  fetchBookingMessages,
  sendBookingMessage,
} from "@/lib/channels/channex-messages";

// Exercises the outbound half of guest messaging: POST to a booking's message
// thread, then read the thread back to confirm the message landed with
// sender "property".
//
// Uses the same fetchBookingMessages/sendBookingMessage the production path
// uses, so a pass here is evidence about the real code rather than about a
// one-off probe. Booking-scoped rather than thread-scoped because thread ids
// on the shared sandbox are short-lived - an earlier version of this probe
// pinned one and started returning 404 once it was purged.
//
//   GET /api/debug/channex-message-probe
//       -> lists reservations with a resolvable Channex booking id
//   GET /api/debug/channex-message-probe?reservationId=<id>
//       -> reads that booking's thread, sends nothing
//   GET /api/debug/channex-message-probe?reservationId=<id>&send=true[&text=...]
//       -> sends, then reads the thread back
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const send = searchParams.get("send") === "true";
  const text = searchParams.get("text") || "Hello from StayHQ - this is an automated connectivity test, no reply needed.";

  if (!reservationId) {
    const rows = await prisma.reservation.findMany({
      where: { externalId: { startsWith: "channex-" }, property: { ownerId: userId } },
      include: { guest: { select: { name: true } } },
      orderBy: { checkIn: "asc" },
    });
    return NextResponse.json({
      hint: "Pass ?reservationId=<id>, then &send=true to post a message.",
      reservations: rows.map((r) => ({
        reservationId: r.id,
        guest: r.guest.name,
        checkIn: r.checkIn,
        channexBookingId: channexBookingIdFromExternalId(r.externalId ?? ""),
      })),
    });
  }

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: userId } },
    include: { guest: { select: { name: true } } },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const bookingId = channexBookingIdFromExternalId(reservation.externalId ?? "");
  if (!bookingId) {
    return NextResponse.json({ error: "That reservation has no Channex booking id" }, { status: 400 });
  }

  const result: Record<string, unknown> = { guest: reservation.guest.name, bookingId };

  if (send) {
    try {
      const sent = await sendBookingMessage(bookingId, text);
      result.send = { status: "ok", text, response: sent };
    } catch (err) {
      const e = err as ChannexError;
      result.send = { status: "failed", text, error: { message: e.message, status: e.status, code: e.code, details: e.details } };
    }
  } else {
    result.send = "skipped - add &send=true to actually post";
  }

  // Read back regardless: on a send this proves the message landed, and on a
  // dry run it shows what the thread already holds.
  try {
    const messages = await fetchBookingMessages(bookingId);
    result.thread = messages.map((m) => ({
      sender: m.attributes.sender,
      message: m.attributes.message?.slice(0, 200),
      inserted_at: m.attributes.inserted_at,
    }));
  } catch (err) {
    const e = err as ChannexError;
    result.thread = { error: e.message, status: e.status, code: e.code };
  }

  return NextResponse.json(result);
}
