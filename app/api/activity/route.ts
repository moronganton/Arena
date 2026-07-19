import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Live counts for navigation badges (bottom tab bar on mobile)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = session.user.id;

  const dayAgo = new Date(Date.now() - 86400000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const [messagesAttention, newBookings, cleaningToday, openDamages] = await Promise.all([
    // Unread guest messages + answered-but-flagged questions
    prisma.message.count({
      where: {
        direction: "INBOUND",
        reservation: { property: { ownerId } },
        OR: [{ isRead: false }, { needsHostReply: true }],
      },
    }),
    prisma.reservation.count({
      where: { createdAt: { gte: dayAgo }, status: { not: "CANCELLED" }, property: { ownerId } },
    }),
    prisma.cleaningTask.count({
      where: {
        scheduledDate: { gte: todayStart, lt: todayEnd },
        status: { not: "COMPLETED" },
        property: { ownerId },
      },
    }),
    prisma.damageReport.count({ where: { status: "OPEN", property: { ownerId } } }),
  ]);

  return NextResponse.json({
    messages: messagesAttention,
    bookings: newBookings,
    moreDot: cleaningToday + openDamages > 0,
  });
}
