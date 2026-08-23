import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// The UI shows "ready to charge" (status SAVED) for a reservation, but
// chargeSavedCard() just threw "No saved card on file" for the same
// reservation - those two reads should never disagree. Dumps the full row
// (minus nothing, this is debug-only) to see exactly what's actually
// stored.
//
//   GET /api/debug/guest-card-check?reservationId=<id>
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const card = await prisma.guestCardOnFile.findUnique({ where: { reservationId } });
  const allForOwner = await prisma.guestCardOnFile.findMany({
    where: { reservation: { property: { ownerId: access.userId } } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ reservationId, card, allForOwner });
}
