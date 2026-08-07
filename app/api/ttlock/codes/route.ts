import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAccessCode } from "@/lib/ttlock";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");

  const codes = await prisma.accessCode.findMany({
    where: {
      ...(reservationId ? { reservationId } : {}),
      lock: { property: { ownerId: session!.user!.id } },
    },
    include: {
      lock: { select: { id: true, name: true } },
      reservation: { include: { guest: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(codes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lockId, reservationId, accessToken } = await req.json();

  const lock = await prisma.smartLock.findFirst({
    where: { id: lockId, property: { ownerId: session!.user!.id } },
  });
  if (!lock) return NextResponse.json({ error: "Lock not found" }, { status: 404 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session!.user!.id } },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const { code, lockError } = await generateAccessCode({
    lockId,
    reservationId,
    validFrom: reservation.checkIn,
    validTo: reservation.checkOut,
    accessToken,
  });

  return NextResponse.json({ code, lockError }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const code = await prisma.accessCode.findFirst({
    where: { id, lock: { property: { ownerId: session!.user!.id } } },
  });
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.accessCode.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
