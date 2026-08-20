import { prisma } from "@/lib/prisma";
import { channexGet, channexPost } from "@/lib/channels/channex-core";
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

export async function fetchBookingMessages(
  bookingId: string
): Promise<Array<{ id: string; attributes: ChannexMessageAttributes }>> {
  const res = await channexGet<Array<{ id: string; attributes: ChannexMessageAttributes }>>(`/bookings/${bookingId}/messages`);
  return res.data ?? [];
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
