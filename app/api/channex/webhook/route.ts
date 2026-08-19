import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Receives Channex webhook deliveries.
//
// ALWAYS returns 200, even when our own processing fails. This is a Channex
// certification requirement, not a shortcut: a non-2xx makes Channex retry
// and eventually disable the webhook entirely, which would silently stop all
// booking intake. Failures are recorded in ChannexWebhookLog and surfaced
// through /api/debug/channex-webhook-log instead.
//
// The only case that returns non-200 is a failed shared-secret check, which
// is a rejected request rather than a failed delivery - see below.
//
// Auth: the registered webhook currently has headers: null, meaning Channex
// sends no shared secret and anything on the internet could POST here. That
// is acceptable only because processing is presently limited to storing the
// payload, and because a booking's authoritative data is re-fetched from the
// Channex API by ID rather than trusted from the request body. Before this
// endpoint creates real reservations for a live property, set a header in
// the Channex webhook UI (Headers: {"x-webhook-secret": "..."}) and the
// matching CHANNEX_WEBHOOK_SECRET env var, and this will start enforcing it.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Capture headers first - if the shared secret is ever misconfigured, the
  // stored headers are what makes it diagnosable. Authorization-style values
  // are redacted so the log can't become a place secrets sit in plaintext.
  const headerObj: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    const sensitive = k === "authorization" || k.includes("secret") || k.includes("api-key") || k === "cookie";
    headerObj[key] = sensitive ? `[redacted, length ${value.length}]` : value;
  });

  const expectedSecret = process.env.CHANNEX_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== expectedSecret) {
      // Deliberately NOT logged to ChannexWebhookLog: an unauthenticated
      // caller must not be able to fill that table. 401 (not 200) because
      // this is a rejected request, not a delivery we failed to process.
      console.warn("[channex-webhook] rejected: bad or missing x-webhook-secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // Left null - the raw body is stored regardless, which is the point.
  }

  const event =
    (parsed as { event?: string; event_mask?: string } | null)?.event ??
    (parsed as { event_mask?: string } | null)?.event_mask ??
    null;

  let logId: string | null = null;
  try {
    const log = await prisma.channexWebhookLog.create({
      data: {
        event,
        payload: rawBody.slice(0, 100_000),
        headers: JSON.stringify(headerObj),
        processedOk: false,
      },
    });
    logId = log.id;
  } catch (err) {
    // If even the logging write fails, still return 200 - Channex must not
    // retry or disable the webhook over our own storage problem.
    console.error("[channex-webhook] failed to persist delivery:", err);
    return NextResponse.json({ received: true });
  }

  try {
    // Booking processing is deliberately not implemented yet: the real
    // payload shape is still unknown (the API refuses to create bookings,
    // so no sample exists), and guessing it would mean writing reservation
    // upsert logic against an invented schema. The stored payload from the
    // first real delivery is what that will be built from.
    console.log(`[channex-webhook] stored delivery ${logId} (event=${event ?? "unknown"}, ${rawBody.length} bytes)`);
    await prisma.channexWebhookLog.update({ where: { id: logId }, data: { processedOk: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[channex-webhook] processing failed for ${logId}:`, err);
    await prisma.channexWebhookLog
      .update({ where: { id: logId }, data: { processedOk: false, error: message.slice(0, 1000) } })
      .catch(() => {});
  }

  return NextResponse.json({ received: true });
}

// Channex's dashboard may probe the URL with a GET before saving a webhook.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "channex webhook receiver" });
}
