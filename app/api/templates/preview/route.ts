import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderTemplate, valuesFromReservation, SAMPLE_VALUES, type TemplateReservation } from "@/lib/templates";

// POST /api/templates/preview { body, reservationId? }
// Renders the template body with a real reservation's data (or sample data if
// no reservation is given), so the host sees the exact message before sending.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body, reservationId } = await req.json();
  if (typeof body !== "string") return NextResponse.json({ error: "body required" }, { status: 400 });

  if (!reservationId) {
    return NextResponse.json({ rendered: renderTemplate(body, SAMPLE_VALUES), usingSample: true });
  }

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    include: {
      guest: { select: { name: true } },
      property: { select: { name: true, address: true } },
      accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
    },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const values = valuesFromReservation(reservation as unknown as TemplateReservation, session.user.name);
  return NextResponse.json({ rendered: renderTemplate(body, values), usingSample: false });
}
