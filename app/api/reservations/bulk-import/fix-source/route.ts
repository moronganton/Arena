import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_SOURCES = new Set(["BOOKING", "AIRBNB", "VRBO", "EXPEDIA", "DIRECT"]);

// One-off correction for reservations created by the bulk importer before it
// defaulted to Booking.com: relabels any of the current user's own
// "Bulk-imported" reservations still sitting on source DIRECT to the given
// source (Booking.com by default, since every real import so far has been a
// Booking.com Extranet export).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" && VALID_SOURCES.has(body.to) ? body.to : "BOOKING";

  const result = await prisma.reservation.updateMany({
    where: {
      property: { ownerId: session.user.id },
      internalNotes: { startsWith: "Bulk-imported" },
      source: "DIRECT",
    },
    data: { source: to },
  });

  return NextResponse.json({ updated: result.count, to });
}
