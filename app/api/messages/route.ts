import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/ai";
import { sendMessageToGuest } from "@/lib/notifications";
import { sendSmoobuGuestMessage, syncSmoobuMessagesForReservation } from "@/lib/channels/smoobu-core";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const unreadOnly = searchParams.get("unread") === "true";

  // When viewing a specific thread, pull the latest messages from Smoobu first
  // so guest replies from Booking.com/Airbnb appear without waiting for a sync
  if (reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, property: { ownerId: session!.user!.id } },
      select: { id: true, externalId: true },
    });
    if (reservation?.externalId?.startsWith("smoobu-")) {
      try {
        const newIds = await syncSmoobuMessagesForReservation(session!.user!.id!, reservation);
        for (const id of newIds) {
          await processIncomingMessage(id);
        }
      } catch (err) {
        console.error("On-demand Smoobu message sync failed:", err);
      }
    }
  }

  const messages = await prisma.message.findMany({
    where: {
      reservation: { property: { ownerId: session!.user!.id } },
      ...(reservationId ? { reservationId } : {}),
      ...(unreadOnly ? { isRead: false, direction: "INBOUND" } : {}),
    },
    include: {
      reservation: {
        include: {
          guest: true,
          property: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { reservationId, messageBody, internal, channel, replyToId, saveToKnowledge } = body;
  // Internal notes are private: saved to the thread, never emailed or relayed
  const isInternal = internal === true || channel === "INTERNAL";

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session!.user!.id } },
    include: { guest: true, property: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const message = await prisma.message.create({
    data: {
      body: messageBody,
      direction: "OUTBOUND",
      channel: isInternal ? "INTERNAL" : "PLATFORM",
      reservationId,
      senderId: session!.user!.id,
    },
    include: { reservation: { include: { guest: true, property: true } } },
  });

  if (isInternal) {
    return NextResponse.json({ ...message, channelRelay: null, knowledgeSaved: false }, { status: 201 });
  }

  // The host replied — clear any "AI couldn't answer" highlights in this thread
  await prisma.message.updateMany({
    where: { reservationId, direction: "INBOUND", needsHostReply: true },
    data: { needsHostReply: false },
  });

  // Store the question + this answer in the property knowledge base so the
  // AI can answer similar questions on its own next time
  let knowledgeSaved = false;
  if (saveToKnowledge && replyToId) {
    const question = await prisma.message.findFirst({
      where: { id: replyToId, reservationId, direction: "INBOUND" },
    });
    if (question) {
      await prisma.propertyKnowledge.create({
        data: {
          propertyId: reservation.propertyId,
          category: "FAQ",
          title: question.body.replace(/\s+/g, " ").trim().slice(0, 100),
          content: messageBody,
        },
      });
      knowledgeSaved = true;
    }
  }

  // Send via email if guest has email address
  if (reservation.guest.email) {
    await sendMessageToGuest({
      guestName: reservation.guest.name,
      guestEmail: reservation.guest.email,
      propertyName: reservation.property.name,
      messageBody,
      reservationId,
    });
  }

  // If the booking came through Smoobu, also relay the message through the
  // booking channel (Booking.com / Airbnb inbox) so the guest sees it there.
  let channelRelay: string | null = null;
  if (reservation.externalId?.startsWith("smoobu-")) {
    try {
      const sent = await sendSmoobuGuestMessage(
        session!.user!.id!,
        reservation.externalId,
        messageBody
      );
      channelRelay = sent ? "sent" : "skipped";
    } catch (err) {
      console.error("Failed to relay message via Smoobu:", err);
      channelRelay = "failed";
    }
  }

  return NextResponse.json({ ...message, channelRelay, knowledgeSaved }, { status: 201 });
}

// Mark messages as read
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reservationId } = await req.json();

  await prisma.message.updateMany({
    where: {
      reservationId,
      direction: "INBOUND",
      isRead: false,
      reservation: { property: { ownerId: session!.user!.id } },
    },
    data: { isRead: true },
  });

  return NextResponse.json({ success: true });
}
