import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOrReuseCityTaxCharge, quoteCityTax, stripeConfigured, getGuestCardOnFile } from "@/lib/city-tax";
import { resolveAppOrigin } from "@/lib/app-url";

//   GET  /api/city-tax?reservationId=...   -> quote + charge history for one stay
//   GET  /api/city-tax                     -> account-wide "who paid" report
//   POST /api/city-tax  { reservationId, amountCents? }  -> creates/reuses a payment link
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reservationId = new URL(req.url).searchParams.get("reservationId");

  if (reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, property: { ownerId: session.user.id } },
      include: { property: true, cityTaxCharges: { orderBy: { createdAt: "desc" } } },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    return NextResponse.json({
      configured: !!reservation.property.cityTaxPerNight,
      quote: quoteCityTax(reservation.property, reservation),
      charges: reservation.cityTaxCharges,
      card: await getGuestCardOnFile(reservationId),
    });
  }

  // Account-wide report: every charge across every property this user owns,
  // newest first - the "always see who paid or not" view.
  const charges = await prisma.cityTaxCharge.findMany({
    where: { reservation: { property: { ownerId: session.user.id } } },
    include: { reservation: { include: { guest: true, property: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ charges });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!stripeConfigured()) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not set in Railway yet" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { reservationId, amountCents } = body as { reservationId?: string; amountCents?: number };
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  try {
    const result = await createOrReuseCityTaxCharge(reservationId, amountCents, resolveAppOrigin(req));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create payment link" }, { status: 400 });
  }
}
