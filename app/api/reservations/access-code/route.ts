import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAccessCode } from "@/lib/ttlock";

function applyTimeToDate(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lockId, reservationId } = await req.json();

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    include: { property: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const lock = await prisma.smartLock.findFirst({
    where: { id: lockId, property: { ownerId: session.user.id } },
  });
  if (!lock) return NextResponse.json({ error: "Lock not found" }, { status: 404 });

  try {
    const validFrom = applyTimeToDate(reservation.checkIn, lock.checkInTime);
    const validTo = applyTimeToDate(reservation.checkOut, lock.checkOutTime);

    const code = await generateAccessCode({
      lockId,
      reservationId,
      validFrom,
      validTo,
    });

    const accessCode = await prisma.accessCode.findFirst({
      where: { code, reservationId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      code,
      validFrom: accessCode?.validFrom.toISOString(),
      validTo: accessCode?.validTo.toISOString(),
    });
  } catch (err) {
    console.error("Failed to generate access code:", err);
    return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
  }
}
