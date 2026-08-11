import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";

// Sends a real push notification to every device this account has subscribed,
// right now — the only way to actually confirm delivery rather than just
// inspect the pipeline. Complements /api/push/status, which reports
// configuration state (VAPID present, how many devices are subscribed) but
// never sends anything.
//   GET /api/debug/test-push
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const vapidConfigured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: session.user.id },
    select: { id: true, userAgent: true, createdAt: true },
  });

  if (!vapidConfigured) {
    return NextResponse.json({
      sent: false,
      vapidConfigured: false,
      subscriptionCount: subscriptions.length,
      verdict: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set on the server — push cannot work at all until they are, regardless of what any device does.",
    });
  }

  if (subscriptions.length === 0) {
    return NextResponse.json({
      sent: false,
      vapidConfigured: true,
      subscriptionCount: 0,
      verdict: "Server is configured correctly, but this account has no subscribed devices. On the phone: open the bell icon and tap \"Enable push\" (on iPhone, the app must be added to the Home Screen first — a plain Safari tab cannot subscribe).",
    });
  }

  await notifyUser(session.user.id, {
    type: "info",
    title: "Test push",
    body: `Sent ${new Date().toLocaleTimeString("en-GB")} — if this reached your phone, push is working.`,
    link: "/dashboard",
  });

  return NextResponse.json({
    sent: true,
    vapidConfigured: true,
    subscriptionCount: subscriptions.length,
    subscriptions: subscriptions.map((s) => ({ userAgent: s.userAgent, since: s.createdAt })),
    verdict: `Push attempted to ${subscriptions.length} device(s). Check the phone now — if nothing arrives within a few seconds, check Railway logs for "[notify] push send failed" to see why.`,
  });
}
