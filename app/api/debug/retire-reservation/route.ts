import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { releaseCancelledReservation } from "@/lib/channels/channex-bookings";

// Manually cancels one reservation - revokes its door codes from the real
// lock, removes its pending cleaning task, marks it CANCELLED. The same
// side effects a normal cancellation produces, run by hand.
//
// Built for the externalId bug: a real modify created a second reservation
// instead of updating the first, so the stale one now holds a real door
// code for dates that no longer describe the booking. Kept general rather
// than one-off, since "a reservation needs retiring by hand" is not
// specific to that bug alone.
//
//   GET /api/debug/retire-reservation?reservationId=xxx            (dry run)
//   GET /api/debug/retire-reservation?reservationId=xxx&apply=true
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const apply = searchParams.get("apply") === "true";
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: access.userId } },
    select: {
      id: true,
      status: true,
      externalId: true,
      checkIn: true,
      checkOut: true,
      guest: { select: { name: true } },
      property: { select: { name: true, ownerId: true } },
      accessCodes: { where: { isActive: true }, select: { id: true } },
      cleaningTasks: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing changed",
      reservation: {
        guest: reservation.guest.name,
        property: reservation.property.name,
        stay: `${reservation.checkIn.toISOString().slice(0, 10)} -> ${reservation.checkOut.toISOString().slice(0, 10)}`,
        status: reservation.status,
        externalId: reservation.externalId,
        activeCodes: reservation.accessCodes.length,
        pendingCleaningTasks: reservation.cleaningTasks.length,
      },
      hint: "Re-run with &apply=true to cancel it and revoke its codes.",
    });
  }

  if (reservation.status === "CANCELLED") {
    return NextResponse.json({ mode: "already cancelled - nothing to do" });
  }

  await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED" } });
  await releaseCancelledReservation(reservation.id, reservation.property.ownerId, `manual retire of ${reservation.id}`);

  return NextResponse.json({
    mode: "applied",
    reservationId: reservation.id,
    codesRevoked: reservation.accessCodes.length,
    cleaningTasksRemoved: reservation.cleaningTasks.length,
  });
}
