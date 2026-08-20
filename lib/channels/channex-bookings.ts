import { prisma } from "@/lib/prisma";
import { channexGet } from "@/lib/channels/channex-core";
import {
  autoGenerateCodesForReservation,
  revokeAccessCodesForReservation,
  updateAccessCodePeriodsForReservation,
} from "@/lib/ttlock";

// Turns a Channex booking into StayHQ Reservation row(s), mirroring the
// pattern syncSmoobuBookings already uses for Smoobu (same externalId
// convention, same create-vs-update branch, same access-code side effects) -
// confirmed against real payloads read from the staging API (via
// /api/debug/channex-bookings-raw), not guessed.
//
// Shape notes from that real data:
//   - A booking can hold multiple `rooms[]` entries; StayHQ only cares about
//     ones actually mapped to one of our Channex room-type/rate-plan pairs -
//     unmapped rooms have room_type_id/rate_plan_id = null and are skipped.
//   - Each room's booking_room_id is the stable per-room-stay id, so it's
//     used as the externalId (one Reservation = one room-stay, same as
//     every other source in this schema).
//   - customer only ever carries {name, surname} - no email/phone field
//     exists in this API at all, unlike Smoobu's detail endpoint. Guests
//     import with no contact info; deliverAiMessage already handles that
//     gracefully (skips both the Smoobu relay and the email step when
//     neither applies).

export interface ChannexBookingRoom {
  meta: {
    mapping_id: string | null;
    rate_plan_code: string;
    room_type_code: number;
  };
  amount: string;
  occupancy: { adults: number; children: number; infants: number | null };
  rate_plan_id: string | null;
  room_type_id: string | null;
  booking_room_id: string;
  checkin_date: string;
  checkout_date: string;
  is_cancelled: boolean;
}

export interface ChannexBookingAttributes {
  id: string;
  status: string;
  currency: string;
  amount: string;
  unique_id: string;
  ota_reservation_code: string;
  ota_name: string;
  property_id: string;
  customer?: { name?: string; surname?: string };
  rooms: ChannexBookingRoom[];
}

// Booking data is read through booking revisions, never through /bookings.
// Channex requires this for certification in as many words: "be sure that you
// do not use GET api/v1/bookings... endpoints, use GET
// api/v1/booking_revisions... instead". A revision is the individual message
// an OTA sent; a booking is only ever the latest of them, which is why the
// revision is the thing to acknowledge.
export async function fetchChannexRevision(revisionId: string): Promise<ChannexBookingAttributes> {
  const res = await channexGet<{ attributes?: ChannexBookingAttributes }>(`/booking_revisions/${revisionId}`);
  const attrs = res.data?.attributes;
  if (!attrs?.id) throw new Error(`Channex booking revision ${revisionId} returned no attributes`);
  return attrs;
}

function mapOtaNameToSource(otaName: string | null | undefined): string {
  const n = (otaName || "").toLowerCase();
  if (n.includes("booking")) return "BOOKING";
  if (n.includes("airbnb")) return "AIRBNB";
  if (n.includes("expedia")) return "EXPEDIA";
  if (n.includes("vrbo") || n.includes("homeaway")) return "VRBO";
  return "DIRECT";
}

export async function upsertReservationsFromChannexRevision(
  revisionId: string
): Promise<{ reservationIds: string[]; skipped: string[] }> {
  return upsertReservationsFromBookingData(await fetchChannexRevision(revisionId));
}

// Takes the booking data directly, because the revision feed already returns
// it in full - fetching each revision again by id would be one wasted call
// per booking on a feed that pages ten at a time.
export async function upsertReservationsFromBookingData(
  booking: ChannexBookingAttributes
): Promise<{ reservationIds: string[]; skipped: string[] }> {

  const listings = await prisma.channexListing.findMany({ include: { property: true } });

  const reservationIds: string[] = [];
  const skipped: string[] = [];
  const guestName = `${booking.customer?.name ?? ""} ${booking.customer?.surname ?? ""}`.trim() || "Guest";

  // Group by which StayHQ listing each room resolves to, not one Reservation
  // per room line-item. Confirmed necessary from real data: Channex's shared
  // sandbox hotel returned bookings with two "Double Room" line items for the
  // same dates, both mapped to Sinteu's single room/rate pair - correct for a
  // hotel with several identical physical rooms, but every ChannexListing
  // here represents exactly ONE bookable unit, so two mapped lines in the
  // same booking must collapse into one stay, not two concurrent "whole
  // apartment" reservations for the same nights.
  const byListing = new Map<string, { listing: (typeof listings)[number]; rooms: ChannexBookingRoom[] }>();

  for (const room of booking.rooms) {
    if (!room.room_type_id || !room.rate_plan_id) {
      skipped.push(`room ${room.booking_room_id}: not mapped to a StayHQ room/rate on Channex`);
      continue;
    }
    const listing = listings.find(
      (l) => l.channexRoomTypeId === room.room_type_id && l.channexRatePlanId === room.rate_plan_id
    );
    if (!listing) {
      skipped.push(`room ${room.booking_room_id}: no ChannexListing for that room/rate pair`);
      continue;
    }
    // Same exclusivity gate AriOutbox uses - a property only goes live on
    // the Channex side once explicitly migrated (see migrate-to-channex),
    // so a booking for a still-Smoobu-flagged property is left untouched
    // rather than creating a reservation StayHQ isn't supposed to own yet.
    if (listing.property.channelProvider !== "CHANNEX") {
      skipped.push(`room ${room.booking_room_id}: ${listing.property.name} is not on channelProvider=CHANNEX yet`);
      continue;
    }

    const group = byListing.get(listing.id) ?? { listing, rooms: [] };
    group.rooms.push(room);
    byListing.set(listing.id, group);
  }

  for (const { listing, rooms } of byListing.values()) {
    // Deterministic per (booking, property) - not per room - so reprocessing
    // the same booking is still idempotent even though which rooms exist can
    // shift between deliveries (e.g. a room gets remapped or cancelled).
    const externalId = `channex-${booking.id}-${listing.id}`;
    const checkIn = new Date(Math.min(...rooms.map((r) => new Date(r.checkin_date).getTime())));
    const checkOut = new Date(Math.max(...rooms.map((r) => new Date(r.checkout_date).getTime())));
    const totalAmount = rooms.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0);
    const adults = rooms.reduce((sum, r) => sum + (r.occupancy?.adults ?? 0), 0) || 1;
    const children = rooms.reduce((sum, r) => sum + (r.occupancy?.children ?? 0), 0);
    // Only cancelled once every room line making up this stay is cancelled -
    // a partial cancellation still leaves the guest occupying the unit.
    const allCancelled = rooms.every((r) => r.is_cancelled);
    const status = allCancelled ? "CANCELLED" : "CONFIRMED";

    const existing = await prisma.reservation.findFirst({ where: { externalId } });

    if (!existing) {
      if (allCancelled) {
        skipped.push(`booking ${booking.id} / ${listing.property.name}: already cancelled, nothing to import`);
        continue;
      }

      const guest = await prisma.guest.create({ data: { name: guestName } });
      const reservation = await prisma.reservation.create({
        data: {
          externalId,
          confirmationCode: booking.unique_id || booking.ota_reservation_code,
          propertyId: listing.propertyId,
          guestId: guest.id,
          checkIn,
          checkOut,
          adults,
          children,
          totalAmount: totalAmount || undefined,
          currency: booking.currency || listing.property.currency,
          source: mapOtaNameToSource(booking.ota_name),
          status,
        },
      });
      reservationIds.push(reservation.id);

      const gen = await autoGenerateCodesForReservation(reservation.id, listing.propertyId);
      console.log(
        `[channex-bookings] booking ${booking.id} -> ${listing.property.name}: generated ${gen.codes.length} code(s)` +
          (gen.errors.length ? `, errors: ${gen.errors.join("; ")}` : "")
      );

      // No existing cron creates cleaning tasks from a reservation for any
      // source today - this is the first one, scoped to Channex per the
      // task. A turnover cleaning on checkout day, same as a host would add
      // by hand.
      await prisma.cleaningTask.create({
        data: { propertyId: listing.propertyId, reservationId: reservation.id, scheduledDate: checkOut, status: "PENDING" },
      });

      // Deliberately NOT calling enqueueAriUpdate here: these nights are
      // already reflected in Channex's own inventory (that's why this
      // booking exists), and Channex propagates it to every channel it
      // manages on its own. Pushing it back out would just be a redundant
      // round trip to the source that told us about it.
    } else {
      const datesChanged =
        existing.checkIn.getTime() !== checkIn.getTime() || existing.checkOut.getTime() !== checkOut.getTime();
      const becameCancelled = allCancelled && existing.status !== "CANCELLED";

      await prisma.reservation.update({
        where: { id: existing.id },
        data: {
          status,
          checkIn,
          checkOut,
          adults,
          children,
          totalAmount: totalAmount || existing.totalAmount,
          currency: booking.currency || existing.currency,
        },
      });
      reservationIds.push(existing.id);

      if (becameCancelled) {
        await revokeAccessCodesForReservation(existing.id, listing.property.ownerId);
        // Drop the turnover clean too. Without this a cleaner is still
        // scheduled for a guest who is no longer coming, which is a real
        // person making a real trip. Only PENDING tasks are removed -
        // anything already in progress or completed describes work that
        // actually happened and stays on the record.
        await prisma.cleaningTask.deleteMany({ where: { reservationId: existing.id, status: "PENDING" } });
        console.log(`[channex-bookings] booking ${booking.id} cancelled: codes revoked, pending clean removed`);
        // No availability push is needed here: the cancellation came from
        // Channex, so it already knows. The nights free themselves anyway -
        // buildAriValues ignores cancelled stays, so the next push for any
        // reason reports them available again.
      } else if (datesChanged && !allCancelled) {
        await updateAccessCodePeriodsForReservation(existing.id, listing.property.ownerId, checkIn, checkOut);
        await prisma.cleaningTask.updateMany({
          where: { reservationId: existing.id, status: "PENDING" },
          data: { scheduledDate: checkOut },
        });
      }
    }
  }

  return { reservationIds, skipped };
}
