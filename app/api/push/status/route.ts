import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/push/status — self-check for the push pipeline, without needing
// direct database access: is the server configured with VAPID keys, and does
// this account have any devices actually subscribed to push.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vapidConfigured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id },
    select: { id: true, userAgent: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const recentNotifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { type: true, title: true, createdAt: true },
  });

  return NextResponse.json({
    vapidConfigured,
    subscriptionCount: subscriptions.length,
    subscriptions,
    recentNotifications,
  });
}
