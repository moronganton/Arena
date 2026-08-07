import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAccessCode, updateAccessCodeValidity, deleteAccessCode } from "@/lib/ttlock";
import { cetInputValueToUtc } from "@/lib/cet";

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

    const { code, lockError } = await generateAccessCode({
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
      // Saved in StayHQ either way — this tells the host the door itself
      // will not open on it yet.
      lockError,
    });
  } catch (err) {
    console.error("Failed to generate access code:", err);
    return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
  }
}

// PATCH /api/reservations/access-code { accessCodeId, validFrom, validTo }
// Adjusts an existing code's validity window — an early check-in or late
// check-out. Both times arrive as "YYYY-MM-DDTHH:mm" CET wall-clock strings and
// are converted here, so the result never depends on the host device's timezone.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accessCodeId, validFrom, validTo } = await req.json();
  if (!accessCodeId) return NextResponse.json({ error: "accessCodeId required" }, { status: 400 });

  const from = typeof validFrom === "string" ? cetInputValueToUtc(validFrom) : null;
  const to = typeof validTo === "string" ? cetInputValueToUtc(validTo) : null;
  if (!from || !to) {
    return NextResponse.json({ error: "Enter a valid start and end date/time." }, { status: 400 });
  }
  if (to <= from) {
    return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
  }

  try {
    const { ok, lockError } = await updateAccessCodeValidity(accessCodeId, session.user.id, from, to);

    // 207: StayHQ was updated but the physical lock refused — the host must know,
    // because the guest's door will still be running the old window.
    return NextResponse.json(
      {
        success: ok,
        validFrom: from.toISOString(),
        validTo: to.toISOString(),
        lockError,
      },
      { status: ok ? 200 : 207 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update validity";
    const status = msg === "Access code not found" ? 404 : 500;
    console.error("Failed to update access code validity:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/reservations/access-code?accessCodeId=...
// Removes the PIN from the physical lock and then deletes the record. If the
// lock refuses, the record is kept and 409 returned — a code that still opens
// the door must never disappear from the host's list.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessCodeId = new URL(req.url).searchParams.get("accessCodeId");
  if (!accessCodeId) return NextResponse.json({ error: "accessCodeId required" }, { status: 400 });

  try {
    const { deleted, lockError } = await deleteAccessCode(accessCodeId, session.user.id);
    if (!deleted) {
      return NextResponse.json({ success: false, lockError }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete code";
    const status = msg === "Access code not found" ? 404 : 500;
    console.error("Failed to delete access code:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
