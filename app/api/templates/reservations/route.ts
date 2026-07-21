import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/templates/reservations — recent reservations to preview/test a
// template against, using real guest data.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reservations = await prisma.reservation.findMany({
    where: { property: { ownerId: session.user.id } },
    orderBy: { checkIn: "desc" },
    take: 30,
    select: {
      id: true,
      checkIn: true,
      guest: { select: { name: true } },
      property: { select: { name: true } },
    },
  });

  return NextResponse.json({
    reservations: reservations.map((r) => ({
      id: r.id,
      label: `${r.guest.name} · ${r.property.name} · ${r.checkIn.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    })),
  });
}
