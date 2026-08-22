import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { relayMessageToChannel } from "@/lib/channels/relay";

// POST { id } - re-attempt delivering an outbound message to the booking
// channel (Booking.com / Airbnb, via Smoobu or Channex) after a previous relay
// failed. Goes through the shared relay so it covers every channel; it
// previously accepted Smoobu bookings only and rejected everything else as
// "not linked to a booking channel".
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const message = await prisma.message.findFirst({
    where: { id, direction: "OUTBOUND", reservation: { property: { ownerId: session.user.id } } },
    include: { reservation: { select: { externalId: true } } },
  });
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  // Re-attempt with the same attachment (if any) it was sent with the first
  // time - only the first, matching the one-attachment-per-call shape
  // relayMessageToChannel already enforces.
  const attachment: string | undefined = message.attachments ? (JSON.parse(message.attachments) as string[])[0] : undefined;

  const relay = await relayMessageToChannel(
    { externalId: message.reservation.externalId, ownerId: session.user.id },
    message.body,
    attachment
  );

  if (relay.status === "sent") {
    await prisma.message.update({ where: { id }, data: { channelFailed: false, channelError: null } });
    return NextResponse.json({ success: true, provider: relay.provider });
  }

  if (relay.status === "skipped") {
    // Nothing to retry against, and no amount of retrying will change that -
    // clear the failure flag rather than leaving a permanently red message.
    await prisma.message.update({ where: { id }, data: { channelFailed: false, channelError: null } });
    return NextResponse.json({ success: false, skipped: relay.reason });
  }

  console.error(`[retry-delivery] ${relay.provider} failed:`, relay.error);
  await prisma.message.update({ where: { id }, data: { channelFailed: true, channelError: relay.error.slice(0, 300) } });
  return NextResponse.json({ error: relay.error }, { status: 502 });
}
