import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// One-off addition for a real Airbnb stay the host remembered wasn't in
// StayHQ at all - found by cross-checking the same May gap the duplicate
// hunt already confirmed as vacant (Michal Murin checked out 19 May, the
// next 29th floor stay didn't start until 25 May). No lock codes are
// generated, matching how the bulk importer skips codes for historical
// stays; the confirmation code makes this idempotent to re-run.
const CONFIRMATION_CODE = "HMH8CR9EZC";

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const existing = await prisma.reservation.findFirst({
    where: { property: { ownerId: userId }, confirmationCode: CONFIRMATION_CODE },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ status: "already exists", reservationId: existing.id });
  }

  const property = await prisma.property.findFirst({
    where: { ownerId: userId, name: { startsWith: "29th floor" } },
    select: { id: true, name: true },
  });
  if (!property) {
    return NextResponse.json({ error: "Could not find the 29th floor property" }, { status: 404 });
  }

  const guest = await prisma.guest.create({ data: { name: "Elizabeth" } });

  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestId: guest.id,
      checkIn: new Date("2026-05-19"),
      checkOut: new Date("2026-05-25"),
      adults: 1,
      children: 0,
      totalAmount: 447.16,
      currency: "EUR",
      source: "AIRBNB",
      confirmationCode: CONFIRMATION_CODE,
      externalId: `manual-${CONFIRMATION_CODE}`,
      status: "CONFIRMED",
      internalNotes: "Added manually - Airbnb reservation missing from the original Booking.com export, confirmed against the host's Airbnb app.",
    },
    include: { guest: true, property: { select: { name: true } } },
  });

  return NextResponse.json({
    status: "created",
    reservationId: reservation.id,
    guest: reservation.guest.name,
    property: reservation.property.name,
    checkIn: reservation.checkIn.toISOString().slice(0, 10),
    checkOut: reservation.checkOut.toISOString().slice(0, 10),
    amount: reservation.totalAmount,
    source: reservation.source,
  });
}
