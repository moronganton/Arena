import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Notification center + Web Push. notifyUser() writes an in-app notification
// (always) and, if the device opted into push, also delivers it to the phone.
//
// Web Push needs a VAPID key pair. Set these in Railway → Variables:
//   VAPID_PUBLIC_KEY   (also read by the browser to subscribe)
//   VAPID_PRIVATE_KEY  (secret — never commit)
//   VAPID_SUBJECT      (optional, defaults to a mailto: placeholder)
// Without them, in-app notifications still work; push is simply skipped.

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@stayhq.app", pub, priv);
  vapidReady = true;
  return true;
}

export type NotificationType =
  | "guest_reply"
  | "ai_paused"
  | "delivery_failed"
  | "checkout"
  | "mapping_issue"
  | "info";

interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

// Create an in-app notification for a user and push it to their devices.
// Best-effort: a failure here must never break the flow that triggered it.
export async function notifyUser(userId: string, input: NotifyInput): Promise<void> {
  let saved;
  try {
    saved = await prisma.notification.create({
      data: { userId, type: input.type, title: input.title, body: input.body, link: input.link },
    });
  } catch (err) {
    console.error("[notify] failed to save notification:", err);
    return;
  }

  if (!ensureVapid()) return; // push not configured — in-app only

  let subs;
  let unreadCount = 0;
  try {
    [subs, unreadCount] = await Promise.all([
      prisma.pushSubscription.findMany({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
  } catch (err) {
    console.error("[notify] failed to load push subscriptions:", err);
    return;
  }

  // badge travels with the push so the service worker can set the app icon's
  // unread count even while StayHQ isn't open — no separate fetch needed.
  const payload = JSON.stringify({
    id: saved.id,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link || "/dashboard",
    badge: unreadCount,
  });

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        // 404/410 = the subscription is gone (uninstalled / permission revoked) — prune it
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error(`[notify] push send failed (status=${status ?? "?"}):`, (err as Error)?.message);
        }
      }
    })
  );
}
