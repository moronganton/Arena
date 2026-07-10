import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, deletePasscode, listPasscodes } from "@/lib/ttlock";
import { sendCancellationEmail } from "@/lib/notifications";

// Deactivate all access codes for a reservation and remove them from the physical locks.
// Returns a report so failures can be surfaced to the UI instead of hidden.
async function revokeAccessCodes(reservationId: string, ownerId: string) {
  const codes = await prisma.accessCode.findMany({
    where: { reservationId, isActive: true },
    include: { lock: true },
  });
  if (codes.length === 0) return { revoked: 0, lockErrors: [] as string[] };

  const accessToken = await getValidAccessToken(ownerId);
  const lockErrors: string[] = [];

  for (const code of codes) {
    if (code.lock.ttlockId) {
      if (!accessToken) {
        lockErrors.push(`Code ${code.code}: TTLock account not connected — code was NOT removed from the lock`);
      } else {
        try {
          let keyId = code.ttlockKeyId;
          // Fallback: if we never stored the key ID, find the code on the lock by its digits
          if (!keyId) {
            const onLock = await listPasscodes(accessToken, code.lock.ttlockId);
            const match = onLock.find((p) => p.keyboardPwd === code.code);
            keyId = match ? String(match.keyboardPwdId) : null;
          }
          if (keyId) {
            await deletePasscode(accessToken, code.lock.ttlockId, keyId);
          }
          // If not found on the lock, it was never pushed — nothing to remove
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lockErrors.push(`Code ${code.code} on "${code.lock.name}": ${msg}`);
          console.error(`Failed to delete passcode ${code.id} from lock:`, err);
        }
      }
    }
    await prisma.accessCode.update({ where: { id: code.id }, data: { isActive: false } });
  }

  return { revoked: codes.length, lockErrors };
}

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
    const result = await revokeAccessCodes(id, session!.user!.id!);
    await notifyGuestOfCancellation(id, result.revoked > 0);
    return NextResponse.json({ ...updated, lockErrors: result.lockErrors });
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

  const result = await revokeAccessCodes(id, session!.user!.id!);
  await notifyGuestOfCancellation(id, result.revoked > 0);

  return NextResponse.json({ success: true, lockErrors: result.lockErrors });
}
