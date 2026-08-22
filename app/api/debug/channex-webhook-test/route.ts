import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";

// Round-trip check for the fix in channex-set-webhook-secret: fires Channex's
// own POST /webhooks/test against each registered webhook (which sends a
// real test POST to callback_url using that webhook's current headers), then
// reads back the most recent ChannexWebhookLog rows so the result is "did our
// own endpoint see it and accept it," not just "did Channex's test call
// return 200" - Channex's test response only confirms *something* answered,
// not that the x-webhook-secret header actually arrived and matched.
//
//   GET /api/debug/channex-webhook-test
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const existing = await channexGet<
    Array<{
      id: string;
      attributes: {
        event_mask: string;
        callback_url: string;
        property_id: string | null;
        is_global: boolean;
        request_params: Record<string, string> | null;
        headers: Record<string, string> | null;
        is_active: boolean;
        send_data: boolean;
        protected: boolean;
      };
    }>
  >("/webhooks");
  const webhooks = existing.data ?? [];
  if (webhooks.length === 0) {
    return NextResponse.json({ error: "No webhooks registered on this Channex account" }, { status: 404 });
  }

  const beforeCount = await prisma.channexWebhookLog.count();

  const fired: unknown[] = [];
  for (const w of webhooks) {
    try {
      const res = await channexPost("/webhooks/test", {
        webhook: {
          callback_url: w.attributes.callback_url,
          event_mask: w.attributes.event_mask,
          property_id: w.attributes.property_id,
          is_global: w.attributes.is_global,
          request_params: w.attributes.request_params,
          headers: w.attributes.headers,
          is_active: w.attributes.is_active,
          send_data: w.attributes.send_data,
          protected: w.attributes.protected,
        },
      });
      fired.push({ id: w.id, eventMask: w.attributes.event_mask, status: "ok", channexResponse: res.data });
    } catch (err) {
      const e = err as ChannexError;
      fired.push({
        id: w.id,
        eventMask: w.attributes.event_mask,
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  // Channex's test call is synchronous against our endpoint, but give our own
  // write a moment to land before reading it back.
  await new Promise((r) => setTimeout(r, 1500));

  const newLogs = await prisma.channexWebhookLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(webhooks.length, beforeCount === 0 ? 10 : 5),
    select: { id: true, event: true, headers: true, processedOk: true, error: true, createdAt: true },
  });

  const arrived = newLogs.map((l) => {
    let secretHeaderSeen = false;
    try {
      const h = l.headers ? (JSON.parse(l.headers) as Record<string, string>) : {};
      secretHeaderSeen = "x-webhook-secret" in h;
    } catch {
      // leave false
    }
    return { ...l, secretHeaderSeen };
  });

  return NextResponse.json({ testsFired: fired, recentWebhookLogEntries: arrived });
}
