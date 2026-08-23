import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deliverAiMessage } from "@/lib/ai";
import { renderTemplate, valuesFromReservation, type TemplateReservation } from "@/lib/templates";

// POST /api/templates/send-now { templateId?, body, attachments?, reservationId }
// Sends the rendered template to the GUEST for real — relays via the booking
// channel (Smoobu → Booking.com/Airbnb) and emails the guest. Requires a
// reservation. If templateId is given, records the send so the scheduler won't
// also auto-send the same template to that booking.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { templateId, body, attachments, reservationId } = await req.json();
  if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (!reservationId) return NextResponse.json({ error: "Pick a reservation to send to the guest." }, { status: 400 });

  // Taken directly from the request, the same way body already is - so a
  // test send always reflects whatever is currently in the editor, saved or
  // not, rather than a possibly-stale copy from the last save.
  const attachmentList: string[] = Array.isArray(attachments) ? attachments : [];

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    include: {
      guest: { select: { name: true } },
      property: { select: { name: true, address: true } },
      accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
    },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const values = valuesFromReservation(reservation as unknown as TemplateReservation, user?.name);
  const rendered = renderTemplate(body, values).trim();
  if (!rendered) return NextResponse.json({ error: "Message is empty after filling in the fields." }, { status: 400 });

  const message = await prisma.message.create({
    data: {
      body: rendered,
      direction: "OUTBOUND",
      channel: "PLATFORM",
      isRead: true,
      reservationId,
      attachments: attachmentList.length > 0 ? JSON.stringify(attachmentList) : null,
    },
  });
  const channelOk = await deliverAiMessage(message.id); // Smoobu relay + guest email

  // Keep the scheduler from double-sending this template to this booking
  if (templateId) {
    await prisma.messageTemplateSend
      .create({ data: { templateId, reservationId } })
      .catch(() => {}); // ignore if already recorded
  }

  return NextResponse.json({ success: true, channelDelivered: channelOk, guest: reservation.guest.name });
}
