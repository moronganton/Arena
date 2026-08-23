import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexBookingIdFromExternalId, fetchBookingMessages } from "@/lib/channels/channex-messages";

// Read-only: the full, untruncated Channex thread for one reservation,
// attachments field included - channex-probe truncates bodies at ~1500
// chars (cuts off exactly the attachments array on a thread this long) and
// channex-message-probe strips attachments from its response entirely.
//
//   GET /api/debug/channex-thread-raw?reservationId=<id>
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: access.userId } },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  const bookingId = channexBookingIdFromExternalId(reservation.externalId ?? "");
  if (!bookingId) return NextResponse.json({ error: "No Channex booking id on that reservation" }, { status: 400 });

  const messages = await fetchBookingMessages(bookingId);
  const sorted = messages
    .slice()
    .sort((a, b) => new Date(a.attributes.inserted_at).getTime() - new Date(b.attributes.inserted_at).getTime());

  return NextResponse.json({
    bookingId,
    count: sorted.length,
    messages: sorted.map((m) => ({
      id: m.id,
      sender: m.attributes.sender,
      message: m.attributes.message,
      attachments: m.attributes.attachments,
      inserted_at: m.attributes.inserted_at,
    })),
  });
}
