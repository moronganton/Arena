import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  revokeAccessCodesForReservation,
  updateAccessCodePeriodsForReservation,
} from "@/lib/ttlock";
import { sendCancellationEmail, sendDatesChangedEmail } from "@/lib/notifications";

// Notify the guest that their reservation was cancelled
async function notifyGuestOfCancellation(reservationId: string, hadAccessCode: boolean) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { guest: true, property: true },
  });
  if (!reservation?.guest.email) return;

  try {
    await sendCancellationEmail({
      guestName: reservation.guest.name,
      guestEmail: reservation.guest.email,
      propertyName: reservation.property.name,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      hadAccessCode,
    });
  } catch (err) {
    console.error("Failed to send cancellation email:", err);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const reservation = await prisma.reservation.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
    include: {
      guest: true,
      property: { include: { locks: true } },
      messages: { orderBy: { createdAt: "asc" } },
      accessCodes: { include: { lock: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(reservation);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      status: body.status,
      checkIn: body.checkIn ? new Date(body.checkIn) : undefined,
      checkOut: body.checkOut ? new Date(body.checkOut) : undefined,
      adults: body.adults,
      children: body.children,
      totalAmount: body.totalAmount,
      specialRequests: body.specialRequests,
      internalNotes: body.internalNotes,
    },
    include: { guest: true, property: true },
  });

  // If the reservation was cancelled, revoke its lock codes and notify the guest
  if (body.status === "CANCELLED") {
    const result = await revokeAccessCodesForReservation(id, session!.user!.id!);
    await notifyGuestOfCancellation(id, result.revoked > 0);
    return NextResponse.json({ ...updated, lockErrors: result.lockErrors });
  }

  // If the dates changed, adjust the validity period of active lock codes
  const datesChanged =
    updated.checkIn.getTime() !== existing.checkIn.getTime() ||
    updated.checkOut.getTime() !== existing.checkOut.getTime();

  if (datesChanged) {
    const lockErrors = await updateAccessCodePeriodsForReservation(
      id,
      session!.user!.id!,
      updated.checkIn,
      updated.checkOut
    );

    // Notify the guest of the new dates (include their still-valid PIN if one exists)
    if (updated.guest.email) {
      const activeCode = await prisma.accessCode.findFirst({
        where: { reservationId: id, isActive: true },
        orderBy: { createdAt: "desc" },
      });
      try {
        await sendDatesChangedEmail({
          guestName: updated.guest.name,
          guestEmail: updated.guest.email,
          propertyName: updated.property.name,
          checkIn: updated.checkIn,
          checkOut: updated.checkOut,
          accessCode: activeCode?.code,
        });
      } catch (err) {
        console.error("Failed to send dates-changed email:", err);
      }
    }

    return NextResponse.json({ ...updated, lockErrors });
  }

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.reservation.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.reservation.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  const result = await revokeAccessCodesForReservation(id, session!.user!.id!);
  await notifyGuestOfCancellation(id, result.revoked > 0);

  return NextResponse.json({ success: true, lockErrors: result.lockErrors });
}
