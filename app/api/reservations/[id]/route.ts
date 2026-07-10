import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, deletePasscode } from "@/lib/ttlock";

// Deactivate all access codes for a reservation and remove them from the physical locks
async function revokeAccessCodes(reservationId: string, ownerId: string) {
  const codes = await prisma.accessCode.findMany({
    where: { reservationId, isActive: true },
    include: { lock: true },
  });
  if (codes.length === 0) return;

  const accessToken = await getValidAccessToken(ownerId);

  for (const code of codes) {
    if (accessToken && code.ttlockKeyId && code.lock.ttlockId) {
      try {
        await deletePasscode(accessToken, code.lock.ttlockId, code.ttlockKeyId);
      } catch (err) {
        console.error(`Failed to delete passcode ${code.id} from lock:`, err);
      }
    }
    await prisma.accessCode.update({ where: { id: code.id }, data: { isActive: false } });
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

  // If the reservation was cancelled, revoke its lock codes
  if (body.status === "CANCELLED") {
    await revokeAccessCodes(id, session!.user!.id!);
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

  await revokeAccessCodes(id, session!.user!.id!);

  return NextResponse.json({ success: true });
}
