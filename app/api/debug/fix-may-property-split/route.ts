import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One-off correction for 3 May 2026 reservations that were sold and paid out
// under the "29th floor" Booking.com listing back when it still covered two
// physical sub-units, but were actually hosted in what is now the separate
// "28th floor" property (the two listings were split apart in May 2026).
// Confirmed against the guest's own account of who stayed where.
//
// Each row is moved by its Booking.com Book Number (confirmationCode), not by
// name or date, so this can never touch a different reservation by accident.
const MOVES = [
  { confirmationCode: "6122078546", guest: "Martin Klacman" },
  { confirmationCode: "5732317408", guest: "Olexandr Matviiko" },
  { confirmationCode: "5383184777", guest: "Oleh Kutelmakh" },
];

// GET is also supported (not just POST) so this can be run by pasting the
// URL into a browser address bar - fine for a session-gated, idempotent,
// exact-id-matched one-off fix like this.
export async function GET() {
  return run();
}

export async function POST() {
  return run();
}

async function run() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [from, to] = await Promise.all([
    prisma.property.findFirst({
      where: { ownerId: session.user.id, name: { startsWith: "29th floor" } },
      select: { id: true, name: true },
    }),
    prisma.property.findFirst({
      where: { ownerId: session.user.id, name: { startsWith: "28th floor" } },
      select: { id: true, name: true },
    }),
  ]);
  if (!from || !to) {
    return NextResponse.json({ error: "Could not find both the 29th floor and 28th floor properties" }, { status: 404 });
  }

  const results = [];
  for (const move of MOVES) {
    const reservation = await prisma.reservation.findFirst({
      where: { property: { ownerId: session.user.id }, confirmationCode: move.confirmationCode },
      select: { id: true, propertyId: true, checkIn: true, checkOut: true, guest: { select: { name: true } } },
    });
    if (!reservation) {
      results.push({ ...move, status: "not found" });
      continue;
    }
    if (reservation.propertyId !== from.id) {
      results.push({ ...move, status: `skipped - already on a property other than ${from.name}`, currentPropertyId: reservation.propertyId });
      continue;
    }
    await prisma.reservation.update({ where: { id: reservation.id }, data: { propertyId: to.id } });
    results.push({
      ...move,
      status: "moved",
      checkIn: reservation.checkIn.toISOString().slice(0, 10),
      checkOut: reservation.checkOut.toISOString().slice(0, 10),
      from: from.name,
      to: to.name,
    });
  }

  return NextResponse.json({ results });
}
