import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";
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

// upsertReservationsFromChannexBooking (channex-bookings.ts) sets externalId
// to `channex-${booking.id}-${listing.id}` - booking.id is a fixed-width
// UUID and listing.id (a cuid) never contains a dash, so a straight slice
// recovers it reliably without a schema change to store it separately.
export function channexBookingIdFromExternalId(externalId: string): string | null {
  if (!externalId.startsWith(CHANNEX_PREFIX)) return null;
  return externalId.slice(CHANNEX_PREFIX.length, CHANNEX_PREFIX.length + UUID_LENGTH);
}

export interface ChannexMessageAttributes {
  message: string;
  attachments: unknown[];
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

export async function sendBookingMessage(bookingId: string, text: string): Promise<{ id: string; attributes: ChannexMessageAttributes }> {
  const res = await channexPost<{ id: string; attributes: ChannexMessageAttributes }>(`/bookings/${bookingId}/messages`, {
    message: { message: text },
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
export async function importGuestMessagesForBooking(bookingId: string): Promise<{ imported: number }> {
  const reservation = await findReservationByChannexBookingId(bookingId);
  if (!reservation) return { imported: 0 };

  const messages = await fetchBookingMessages(bookingId);
  let imported = 0;

  for (const m of messages) {
    if (m.attributes.sender !== "guest") continue;
    if (!m.attributes.message) continue; // attachment-only message - not handled yet

    const externalId = `channex-msg-${m.id}`;
    const existing = await prisma.message.findFirst({ where: { externalId } });
    if (existing) continue;

    const created = await prisma.message.create({
      data: {
        body: m.attributes.message,
        direction: "INBOUND",
        channel: "PLATFORM",
        externalId,
        reservationId: reservation.id,
        createdAt: new Date(m.attributes.inserted_at),
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

  const result: ChannexMessagePollResult = { reservationsChecked: 0, imported: 0, unsupported: 0, errors: [] };
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
      console.error(`[channex-messages] poll failed for booking ${bookingId}:`, err);
      result.errors.push(`${bookingId}: ${e.message}`);
    }
  }

  return result;
}
