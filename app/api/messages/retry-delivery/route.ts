import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendSmoobuGuestMessage } from "@/lib/channels/smoobu-core";

// POST { id } — re-attempt delivering an outbound message to the booking
// channel (Booking.com/Airbnb via Smoobu) after a previous relay failed.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const message = await prisma.message.findFirst({
    where: { id, direction: "OUTBOUND", reservation: { property: { ownerId: session.user.id } } },
    include: { reservation: { select: { externalId: true } } },
  });
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  if (!message.reservation.externalId?.startsWith("smoobu-")) {
    return NextResponse.json({ error: "This reservation is not linked to a booking channel" }, { status: 400 });
  }

  try {
    await sendSmoobuGuestMessage(session.user.id, message.reservation.externalId, message.body);
    await prisma.message.update({ where: { id }, data: { channelFailed: false, channelError: null } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[retry-delivery] failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.message.update({ where: { id }, data: { channelFailed: true, channelError: msg.slice(0, 300) } });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
