import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { upsertReservationsFromChannexRevision, notifyUnmappedBooking } from "@/lib/channels/channex-bookings";
import { acknowledgeRevision } from "@/lib/channels/channex-revisions";
import { importGuestMessagesForBooking } from "@/lib/channels/channex-messages";

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
    // Channex sends a thin notification - {event, payload:{property_id,
    // booking_id, revision_id}} - not the full booking. Confirmed against
    // real deliveries via /api/debug/channex-webhook-log. The revision id is
    // what gets read and acknowledged: a booking is only ever the latest of
    // its revisions, so a modification or cancellation arrives as a new
    // revision of the same booking.
    const body = parsed as {
      payload?: { booking_id?: string; revision_id?: string; booking_revision_id?: string };
      property_id?: string;
    } | null;
    const payload = body?.payload;
    const revisionId = payload?.revision_id;
    // Unlike "booking", Channex's real payload for these two puts
    // property_id at the ROOT of the delivery, not inside payload - confirmed
    // against the documented example, not assumed from the "booking" shape.
    const rootPropertyId = body?.property_id;

    if (event === "booking" && revisionId) {
      const { reservationIds, skipped } = await upsertReservationsFromChannexRevision(revisionId);
      console.log(
        `[channex-webhook] revision ${revisionId}: ${reservationIds.length} reservation(s) upserted` +
          (skipped.length ? `, skipped: ${skipped.join("; ")}` : "")
      );

      // Only after it is safely stored, per Channex's rule that a booking is
      // acknowledged when saved and not before. An unacknowledged revision
      // stays in the feed and is redelivered, which is the behaviour we want
      // if anything above threw.
      await acknowledgeRevision(revisionId);

      await prisma.channexWebhookLog.update({
        where: { id: logId },
        data: {
          processedOk: true,
          reservationId: reservationIds[0] ?? null,
          error: reservationIds.length === 0 && skipped.length > 0 ? skipped.join("; ").slice(0, 900) : null,
        },
      });
    } else if (event === "message" && payload?.booking_id) {
      // Guest messages are keyed by booking, not revision - the messages API
      // is a sub-resource of the booking and is unaffected by the revisions
      // rule, which is about how bookings themselves are read.
      //
      // This branch has never actually run: no message webhook has ever been
      // delivered, on either test hotel, which is why the scheduled poll is
      // the real inbound route rather than a backstop.
      const { imported } = await importGuestMessagesForBooking(payload.booking_id);
      console.log(`[channex-webhook] message event for booking ${payload.booking_id}: ${imported} guest message(s) imported`);
      await prisma.channexWebhookLog.update({ where: { id: logId }, data: { processedOk: true } });
    } else if ((event === "booking_unmapped_room" || event === "booking_unmapped_rate") && rootPropertyId && payload?.booking_id) {
      // Channex fires these specifically to warn a PMS that a real booking
      // arrived it could not map to a room type or rate plan - its own docs
      // call this "high priority... to prevent any potential problems with
      // overbookings". Left unhandled, an event built to be urgent was
      // silently swallowed by the generic branch below with nothing shown
      // to the host - discovered during a full audit of this route, not
      // from a delivery ever actually being missed.
      await notifyUnmappedBooking(rootPropertyId, payload.booking_id, event === "booking_unmapped_room" ? "room" : "rate");
      await prisma.channexWebhookLog.update({ where: { id: logId }, data: { processedOk: true } });
    } else {
      // Unrecognized or non-booking event - stored for visibility, nothing
      // to process yet.
      console.log(`[channex-webhook] stored delivery ${logId} (event=${event ?? "unknown"}, ${rawBody.length} bytes)`);
      await prisma.channexWebhookLog.update({ where: { id: logId }, data: { processedOk: true } });
    }
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
