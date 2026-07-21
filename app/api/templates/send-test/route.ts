import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderTemplate, valuesFromReservation, SAMPLE_VALUES, type TemplateReservation } from "@/lib/templates";
import { sendTemplateTestEmail } from "@/lib/notifications";

// POST /api/templates/send-test { subject, body, reservationId? }
// Renders the template and emails it to the HOST's own address (never the
// guest), so they can see the real thing before turning it on.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, body, reservationId } = await req.json();
  if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, name: true } });
  if (!user?.email) return NextResponse.json({ error: "Your account has no email address to send the test to." }, { status: 400 });

  let values = SAMPLE_VALUES;
  if (reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, property: { ownerId: session.user.id } },
      include: {
        guest: { select: { name: true } },
        property: { select: { name: true, address: true } },
        accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
      },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    values = valuesFromReservation(reservation as unknown as TemplateReservation, user.name);
  }

  const rendered = renderTemplate(body, values).trim();
  try {
    await sendTemplateTestEmail({ to: user.email, subject: subject?.trim() || "Message from your host", bodyText: rendered });
    return NextResponse.json({ success: true, to: user.email });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send test email" }, { status: 502 });
  }
}
