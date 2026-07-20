import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/push/subscribe — save this device's Web Push subscription so we can
// send it notifications. Body is the PushSubscription JSON from the browser.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sub = await req.json().catch(() => null);
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth_ = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth_) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // Upsert on endpoint: re-subscribing the same device just refreshes its keys
  // and re-points it at the current user.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      p256dh,
      auth: auth_,
      userAgent: req.headers.get("user-agent")?.slice(0, 200),
      userId: session.user.id,
    },
    update: { p256dh, auth: auth_, userId: session.user.id },
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/push/subscribe — remove a device's subscription (opt out).
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: session.user.id } });
  }
  return NextResponse.json({ success: true });
}
