import { prisma } from "@/lib/prisma";
import { channexGet } from "@/lib/channels/channex-core";
import { upsertReservationsFromChannexBooking } from "@/lib/channels/channex-bookings";

// Backstop for the webhook receiver: polls Channex's booking list for
// anything with an unacknowledged revision and runs it through the same
// upsert path the webhook uses. Channex's certification requirements call
// for this alongside webhooks specifically because webhooks alone aren't
// considered reliable enough - a delivery can be missed (network blip, a
// temporary outage on either side) with nothing else to notice.
//
// Deliberately reuses upsertReservationsFromChannexBooking rather than a
// separate implementation - a booking already processed via webhook is just
// reprocessed (idempotent by the (booking, property) externalId), so running
// this on a schedule alongside live webhooks is always safe.
//
// GET /bookings has no confirmed filter for "just the pending ones" - the
// full list is small in this shared sandbox account today, so this pulls
// everything and filters client-side on acknowledge_status /
// has_unacked_revisions (both confirmed fields, seen on real bookings via
// /api/debug/channex-bookings-raw). Worth revisiting for a filtered request
// once the account has real volume - not a now problem.
//
// No booking-acknowledgment call is made here: Channex's dashboard shows an
// "Acked" status per booking, but no ack endpoint has been confirmed against
// the real API (bookings can't be created there directly either, so there's
// never been a live delivery to test one against). Left for whenever that
// gets probed properly, rather than guessed at.
export interface ChannexRevisionsPollResult {
  candidates: number;
  processed: number;
  reservationsTouched: number;
  errors: string[];
}

interface PolledBookingAttributes {
  id: string;
  property_id: string;
  acknowledge_status?: string;
  has_unacked_revisions?: boolean;
}

export async function pollChannexRevisions(): Promise<ChannexRevisionsPollResult> {
  const listings = await prisma.channexListing.findMany({
    where: { property: { channelProvider: "CHANNEX" } },
    select: { channexPropertyId: true },
  });
  const ourPropertyIds = new Set(listings.map((l) => l.channexPropertyId));

  if (ourPropertyIds.size === 0) {
    return { candidates: 0, processed: 0, reservationsTouched: 0, errors: [] };
  }

  const res = await channexGet<Array<{ attributes: PolledBookingAttributes }>>("/bookings");
  const bookings = res.data ?? [];

  const pending = bookings.filter(
    (b) =>
      ourPropertyIds.has(b.attributes.property_id) &&
      (b.attributes.acknowledge_status === "pending" || b.attributes.has_unacked_revisions === true)
  );

  let processed = 0;
  let reservationsTouched = 0;
  const errors: string[] = [];

  for (const b of pending) {
    try {
      const { reservationIds } = await upsertReservationsFromChannexBooking(b.attributes.id);
      reservationsTouched += reservationIds.length;
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[channex-revisions] booking ${b.attributes.id} failed:`, err);
      errors.push(`${b.attributes.id}: ${msg}`);
    }
  }

  return { candidates: pending.length, processed, reservationsTouched, errors };
}
