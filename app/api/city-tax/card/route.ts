import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOrReuseCardSetupLink, chargeSavedCard, stripeConfigured } from "@/lib/city-tax";
import { resolveAppOrigin } from "@/lib/app-url";

// POST /api/city-tax/card  { reservationId }
// Creates/reuses a Stripe "save this card" link - nothing is charged yet.
// See lib/city-tax.ts for the full pre-auth/settle-later reasoning.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!stripeConfigured()) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not set in Railway yet" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { reservationId } = body as { reservationId?: string };
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  try {
    const result = await createOrReuseCardSetupLink(reservationId, resolveAppOrigin(req));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create card link" }, { status: 400 });
  }
}

// PUT /api/city-tax/card  { reservationId, amountCents, description? }
// Charges the card saved above, guest not present.
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { reservationId, amountCents, description } = body as { reservationId?: string; amountCents?: number; description?: string };
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });
  if (!Number.isFinite(amountCents) || !amountCents || amountCents <= 0) {
    return NextResponse.json({ error: "amountCents must be a positive number" }, { status: 400 });
  }

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  try {
    const result = await chargeSavedCard(reservationId, amountCents, description);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Charge failed" }, { status: 400 });
  }
}
