import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAccessCode } from "@/lib/ttlock";

function applyTimeToDateCET(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);

  // Create a formatter for CET to get the offset
  const cetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', // CET/CEST timezone
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Get the CET date parts for our input date
  const cetParts = cetFormatter.formatToParts(date);
  const cetYear = parseInt(cetParts.find(p => p.type === 'year')!.value);
  const cetMonth = parseInt(cetParts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
  const cetDay = parseInt(cetParts.find(p => p.type === 'day')!.value);

  // Create a new date in UTC that represents the desired CET time
  const utcMidnight = new Date(Date.UTC(cetYear, cetMonth, cetDay, 0, 0, 0, 0));

  // Get the offset between UTC and CET for this date (handles DST)
  const cetMidnightParts = cetFormatter.formatToParts(utcMidnight);
  const cetMidnightHour = parseInt(cetMidnightParts.find(p => p.type === 'hour')!.value);
  const offset = cetMidnightHour;

  // Create the target UTC time by subtracting the offset
  const result = new Date(Date.UTC(cetYear, cetMonth, cetDay, hours - offset, minutes, 0, 0));

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
    const validFrom = applyTimeToDateCET(reservation.checkIn, lock.checkInTime);
    const validTo = applyTimeToDateCET(reservation.checkOut, lock.checkOutTime);

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
