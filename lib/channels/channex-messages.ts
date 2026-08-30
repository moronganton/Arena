import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";
import { fetchChannexAttachmentAsDataUrl } from "@/lib/channels/channex-attachments";
import { processIncomingMessage } from "@/lib/ai";

// Two-way guest messaging via Channex, confirmed against the real API docs
// (docs.channex.io/api-v.1-documentation/messages-collection - unreachable
// from this sandbox directly, content relayed by the user) rather than
// guessed: GET/POST https://staging.channex.io/api/v1/bookings/:booking_id/messages,
// payload {message: {message: "text"}}, sender is "guest" | "property" | "system".
//
// Uses the booking-scoped endpoint, not the message_thread one - it needs
// only the Channex booking id, which every Channex-sourced Reservation
// already carries (see below), with no separate thread-id lookup.

const CHANNEX_PREFIX = "channex-";
const UUID_LENGTH = 36; // e.g. "2f2315dd-429a-4a54-bb9d-55bc9b44046b"

// upsertReservationsFromBookingData (channex-bookings.ts) sets externalId to
// `channex-${booking.booking_id}-${listing.id}` - booking.booking_id (the
// STABLE id across every revision of a booking, not the revision's own
// unstable `id` - see the comment on ChannexBookingAttributes for why that
// distinction matters) is a fixed-width UUID, and listing.id (a cuid) never
// contains a dash, so a straight slice recovers it reliably without a
// schema change to store it separately.
export function channexBookingIdFromExternalId(externalId: string): string | null {
  if (!externalId.startsWith(CHANNEX_PREFIX)) return null;
  return externalId.slice(CHANNEX_PREFIX.length, CHANNEX_PREFIX.length + UUID_LENGTH);
}

export interface ChannexMessageAttributes {
  message: string;
  // Paths relative to the API base (confirmed by the docs' own instruction
  // to prepend the environment's API root) - see fetchChannexAttachmentAsDataUrl.
  attachments: string[];
  sender: "guest" | "property" | "system";
  inserted_at: string;
  updated_at: string;
}

const MAX_MESSAGE_PAGES = 20;

// Walks every page, not just the first. Channex defaults to limit 10 sorted
// inserted_at desc, so a thread longer than that silently loses its older
// messages otherwise - the same bug the Smoobu importer carries an explicit
// comment about having hit.
//
// The exact pagination parameter name is NOT confirmed (staging.channex.io is
// unreachable from the dev sandbox, and the docs show pagination only in
// response `meta`, never as a request parameter). `pagination[page]` matches
// the bracketed `filter[...]` convention this API uses elsewhere, but rather
// than trust that guess, the loop stops as soon as a page returns no message
// id it hasn't already seen. If the parameter name is wrong, Channex ignores
// it, page 2 comes back identical to page 1, and the loop exits after two
// requests having lost nothing - it just won't have paged. That case is
// logged, so a wrong guess is visible rather than silent.
export async function fetchBookingMessages(
  bookingId: string
): Promise<Array<{ id: string; attributes: ChannexMessageAttributes }>> {
  const collected: Array<{ id: string; attributes: ChannexMessageAttributes }> = [];
  const seen = new Set<string>();
  let reportedTotal: number | null = null;

  for (let page = 1; page <= MAX_MESSAGE_PAGES; page++) {
    const res = await channexGet<Array<{ id: string; attributes: ChannexMessageAttributes }>>(
      `/bookings/${bookingId}/messages?pagination[page]=${page}&pagination[limit]=100`
    );
    const batch = res.data ?? [];
    const meta = res.meta as { total?: number } | undefined;
    if (typeof meta?.total === "number") reportedTotal = meta.total;

    const fresh = batch.filter((m) => !seen.has(m.id));
    for (const m of fresh) {
      seen.add(m.id);
      collected.push(m);
    }
    // No new ids means either a genuinely exhausted list or an ignored
    // pagination parameter - both end the walk.
    if (fresh.length === 0) break;
  }

  if (reportedTotal !== null && collected.length < reportedTotal) {
    console.warn(
      `[channex-messages] booking ${bookingId}: collected ${collected.length} of ${reportedTotal} message(s) - ` +
        `pagination parameter may not be taking effect`
    );
  }

  return collected;
}

// text may be empty when attachmentId is present - Channex's own docs: "Can
// be empty, if attachments is present."
export async function sendBookingMessage(
  bookingId: string,
  text: string,
  attachmentId?: string
): Promise<{ id: string; attributes: ChannexMessageAttributes }> {
  if (!text && !attachmentId) throw new Error("sendBookingMessage requires text, an attachment, or both");

  const payload: { message?: string; attachment_id?: string } = {};
  if (text) payload.message = text;
  if (attachmentId) payload.attachment_id = attachmentId;

  const res = await channexPost<{ id: string; attributes: ChannexMessageAttributes }>(`/bookings/${bookingId}/messages`, {
    message: payload,
  });
  if (!res.data) throw new Error("Channex returned no data for the sent message");
  return res.data;
}

export function findReservationByChannexBookingId(bookingId: string) {
  return prisma.reservation.findFirst({
    where: { externalId: { startsWith: `${CHANNEX_PREFIX}${bookingId}-` } },
    include: { property: true, guest: true },
  });
}

// Pulls a Channex booking's messages and imports any guest-sent ones not
// already stored, running each through the AI the same way an inbound
// Smoobu-relayed message does. "property" and "system" senders are skipped:
// our own outbound sends are already recorded when sent (see
// deliverAiMessage), and "system" covers things like Airbnb inquiry
// metadata messages, not real guest content.
//
// Attachment-only messages used to be silently dropped here entirely - a
// guest photo of a broken lock, a lost key, a payment screenshot just
// vanished. Each attachment path is fetched and stored as a data URL (see
// fetchChannexAttachmentAsDataUrl); a message with no text gets a short
// placeholder body instead of an empty bubble, since it still needs
// something for the thread list, notifications, and the AI hand-over
// decision below (lib/ai.ts skips auto-reply entirely when attachments are
// present - it has no way to see what is in the photo).
export async function importGuestMessagesForBooking(bookingId: string): Promise<{ imported: number }> {
  const reservation = await findReservationByChannexBookingId(bookingId);
  if (!reservation) return { imported: 0 };

  const messages = await fetchBookingMessages(bookingId);
  let imported = 0;

  for (const m of messages) {
    if (m.attributes.sender !== "guest") continue;
    const attachmentPaths = m.attributes.attachments ?? [];
    if (!m.attributes.message && attachmentPaths.length === 0) continue; // nothing to import

    const externalId = `channex-msg-${m.id}`;
    const existing = await prisma.message.findFirst({ where: { externalId } });
    if (existing) continue;

    const dataUrls: string[] = [];
    for (const path of attachmentPaths) {
      try {
        dataUrls.push(await fetchChannexAttachmentAsDataUrl(path));
      } catch (err) {
        // One bad attachment must not lose the rest of the message - logged,
        // not thrown, so the text (if any) and any other attachments still land.
        console.error(`[channex-messages] failed to fetch an attachment for message ${m.id}:`, err);
      }
    }

    let body = m.attributes.message || "";
    if (!body) {
      body = dataUrls.length > 0 ? (dataUrls.length === 1 ? "Sent a photo" : `Sent ${dataUrls.length} photos`) : "Sent an attachment (couldn't be downloaded)";
    }

    const created = await prisma.message.create({
      data: {
        body,
        direction: "INBOUND",
        channel: "PLATFORM",
        externalId,
        reservationId: reservation.id,
        createdAt: new Date(m.attributes.inserted_at),
        attachments: dataUrls.length > 0 ? JSON.stringify(dataUrls) : null,
      },
    });
    imported++;

    await processIncomingMessage(created.id).catch((err) =>
      console.error(`[channex-messages] AI processing failed for message ${created.id}:`, err)
    );
  }

  return { imported };
}

// Scheduled backstop for inbound guest messages, the messaging counterpart to
// pollChannexRevisions.
//
// Webhooks alone are not sufficient here for two separate reasons. The first
// is Channex's own certification stance, which already required a polling
// backstop for bookings: a delivery can be missed and nothing else notices.
// The second is specific to messaging - the `message` webhook's payload shape
// has never been confirmed by a live delivery (the shared sandbox's test
// hotel returns 422 not_supported for messaging), so the receiver's
// assumption that it carries booking_id may simply be wrong. If it is, this
// poller is the ONLY thing importing guest messages, not merely a safety net.
//
// Scope matches the Smoobu message sync: reservations whose stay is current
// or upcoming, plus a week's grace after checkout so a late question still
// lands.
const MESSAGE_POLL_MAX_RESERVATIONS = 40;
const MESSAGE_POLL_MIN_MS_BETWEEN_CALLS = 3500; // same account-wide ~20/min budget the ARI drain respects
const MESSAGE_POLL_CHECKOUT_GRACE_MS = 7 * 86400000;

export interface ChannexMessagePollResult {
  reservationsChecked: number;
  imported: number;
  unsupported: number;
  /**
   * Bookings whose message thread the API key may no longer read - a 403.
   * Counted apart from errors because it is permanent and per-booking: the
   * channel that carried the booking has been disconnected or removed, so no
   * amount of retrying makes the thread readable again.
   */
  forbidden: number;
  errors: string[];
}

export async function pollChannexMessages(): Promise<ChannexMessagePollResult> {
  const reservations = await prisma.reservation.findMany({
    where: {
      property: { channelProvider: "CHANNEX" },
      externalId: { startsWith: CHANNEX_PREFIX },
      status: { not: "CANCELLED" },
      checkOut: { gte: new Date(Date.now() - MESSAGE_POLL_CHECKOUT_GRACE_MS) },
    },
    select: { id: true, externalId: true },
    orderBy: { checkIn: "asc" },
    take: MESSAGE_POLL_MAX_RESERVATIONS,
  });

  const result: ChannexMessagePollResult = {
    reservationsChecked: 0, imported: 0, unsupported: 0, forbidden: 0, errors: [],
  };
  let lastCallAt = 0;

  for (const r of reservations) {
    const bookingId = r.externalId ? channexBookingIdFromExternalId(r.externalId) : null;
    if (!bookingId) continue;

    const sinceLast = Date.now() - lastCallAt;
    if (lastCallAt && sinceLast < MESSAGE_POLL_MIN_MS_BETWEEN_CALLS) {
      await new Promise((resolve) => setTimeout(resolve, MESSAGE_POLL_MIN_MS_BETWEEN_CALLS - sinceLast));
    }
    lastCallAt = Date.now();

    try {
      const { imported } = await importGuestMessagesForBooking(bookingId);
      result.imported += imported;
      result.reservationsChecked++;
    } catch (err) {
      const e = err as ChannexError;
      // 422 not_supported is an expected steady state, not a failure: the
      // property has the Messages app installed but this booking's OTA does
      // not offer a message API (every booking on the shared sandbox test
      // hotel behaves this way). Counting these separately keeps a normal
      // run from looking broken.
      if (e.status === 422 && e.code === "not_supported") {
        result.unsupported++;
        continue;
      }
      // 404 means the booking is gone from Channex's side - nothing to do.
      if (e.status === 404) continue;
      // 403 is permanent for this booking: its channel has been disconnected
      // or removed, so the key may no longer read that thread. Treated like
      // the two above rather than as a run failure - eight such bookings on
      // this account failed every run for a day, which is not an outage, it
      // is eight threads that will never be readable. A credentials problem
      // looks different and is caught below: there, EVERY booking is
      // forbidden and none succeeds.
      if (e.status === 403) {
        result.forbidden++;
        continue;
      }
      console.error(`[channex-messages] poll failed for booking ${bookingId}:`, err);
      result.errors.push(`${bookingId}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Whether a message poll should be reported as a failed run.
 *
 * A per-booking 403 is not a failure: its channel is gone and that thread is
 * unreadable for good. Eight of those turned this cron permanently red, which
 * is worse than useless - a job that is always failing tells you nothing on
 * the day it fails for a real reason.
 *
 * But the same status means something else entirely when it is ALL of them:
 * a key that has lost access, or an app uninstalled. That is an outage and
 * has to be loud. The two are told apart by whether anything succeeded.
 */
export function messagePollFailure(result: ChannexMessagePollResult): string | null {
  if (result.errors.length > 0) return result.errors.join("; ");
  if (result.forbidden > 0 && result.reservationsChecked === 0 && result.unsupported === 0) {
    return `every message thread was forbidden (${result.forbidden}) - the API key may have lost access to the Messages app`;
  }
  return null;
}
