import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET ?day=today|tomorrow — reservations checking out that day, ordered by
// city + address so consecutive cleanings are geographically close.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day") === "tomorrow" ? 1 : 0;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const checkouts = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: start, lt: end },
    },
    include: {
      guest: { select: { name: true } },
      property: { select: { id: true, name: true, address: true, city: true, country: true } },
    },
    // Cluster by location so the cleaning route minimizes travel
    orderBy: [
      { property: { city: "asc" } },
      { property: { address: "asc" } },
      { checkOut: "asc" },
    ],
  });

  // Find cleaning tasks already created for these reservations
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      reservationId: { in: checkouts.map((r) => r.id) },
    },
    select: { id: true, reservationId: true, status: true },
  });
  const taskByReservation = new Map(tasks.map((t) => [t.reservationId, t]));

  return NextResponse.json(
    checkouts.map((r) => ({
      reservationId: r.id,
      guestName: r.guest.name,
      checkOut: r.checkOut,
      property: r.property,
      cleaningTask: taskByReservation.get(r.id) || null,
    }))
  );
}
