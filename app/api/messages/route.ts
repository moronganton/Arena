import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/ai";
import { sendMessageToGuest } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const unreadOnly = searchParams.get("unread") === "true";

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
  const { reservationId, messageBody, channel = "PLATFORM" } = body;

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session!.user!.id } },
    include: { guest: true, property: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const message = await prisma.message.create({
    data: {
      body: messageBody,
      direction: "OUTBOUND",
      channel,
      reservationId,
      senderId: session!.user!.id,
    },
    include: { reservation: { include: { guest: true, property: true } } },
  });

  // Send via email if guest has email address
  if (reservation.guest.email && channel === "EMAIL") {
    await sendMessageToGuest({
      guestName: reservation.guest.name,
      guestEmail: reservation.guest.email,
      propertyName: reservation.property.name,
      messageBody,
      reservationId,
    });
  }

  return NextResponse.json(message, { status: 201 });
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
