import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// Reads back what Channex actually delivered to /api/channex/webhook.
//
// This is how the real booking payload shape gets discovered: the Channex
// API refuses to create bookings directly (403 Forbidden), so no sample can
// be generated from this side - the shape can only come from an actual
// delivery, triggered either by the dashboard's "Send test message" button
// or by a genuine OTA booking.
//
// It is also the operational view for the certification requirement that the
// receiver return 200 even when processing fails: a failure that cannot be
// reported in the HTTP response has to be visible somewhere, and this is it.
//
//   GET /api/debug/channex-webhook-log           -> 20 most recent deliveries
//   GET /api/debug/channex-webhook-log?failed=true -> only failed ones
//   GET /api/debug/channex-webhook-log?id=<id>     -> one delivery, full payload
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const failedOnly = searchParams.get("failed") === "true";

  if (id) {
    const one = await prisma.channexWebhookLog.findUnique({ where: { id } });
    if (!one) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let parsedPayload: unknown = null;
    try {
      parsedPayload = JSON.parse(one.payload);
    } catch {
      // Non-JSON body - the raw string below is still returned.
    }
    return NextResponse.json({
      ...one,
      headers: one.headers ? JSON.parse(one.headers) : null,
      parsedPayload,
    });
  }

  const rows = await prisma.channexWebhookLog.findMany({
    where: failedOnly ? { processedOk: false } : undefined,
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    total: rows.length,
    hint: rows.length === 0
      ? "No deliveries yet. Use the Channex dashboard's 'Send test message' button on the webhook, or wait for a real booking."
      : "Open ?id=<id> for one delivery's full payload.",
    deliveries: rows.map((r) => ({
      id: r.id,
      event: r.event,
      processedOk: r.processedOk,
      error: r.error,
      reservationId: r.reservationId,
      createdAt: r.createdAt,
      payloadBytes: r.payload.length,
      // Enough to recognise the shape at a glance without opening each one.
      payloadPreview: r.payload.slice(0, 400),
    })),
  });
}
