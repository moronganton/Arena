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

// GET /bookings/{id} is the standard REST shape but was never directly
// confirmed - staging.channex.io can't be reached from this sandbox to test
// ahead of time. Only the list endpoint is proven, so that's the fallback if
// the direct fetch doesn't come back in the expected shape.
export async function fetchChannexBooking(bookingId: string): Promise<ChannexBookingAttributes> {
  try {
    const res = await channexGet<{ attributes?: ChannexBookingAttributes }>(`/bookings/${bookingId}`);
    const attrs = res.data?.attributes;
    if (attrs?.id) return attrs;
  } catch {
    // fall through to the list scan below
  }

  const listRes = await channexGet<Array<{ attributes: ChannexBookingAttributes }>>("/bookings");
  const found = (listRes.data ?? []).find((b) => b.attributes?.id === bookingId);
  if (!found) throw new Error(`Channex booking ${bookingId} not found`);
  return found.attributes;
}

function mapOtaNameToSource(otaName: string | null | undefined): string {
  const n = (otaName || "").toLowerCase();
  if (n.includes("booking")) return "BOOKING";
  if (n.includes("airbnb")) return "AIRBNB";
  if (n.includes("expedia")) return "EXPEDIA";
  if (n.includes("vrbo") || n.includes("homeaway")) return "VRBO";
  return "DIRECT";
}

export async function upsertReservationsFromChannexBooking(
  bookingId: string
): Promise<{ reservationIds: string[]; skipped: string[] }> {
  const booking = await fetchChannexBooking(bookingId);

  const listings = await prisma.channexListing.findMany({ include: { property: true } });

  const reservationIds: string[] = [];
  const skipped: string[] = [];
  const guestName = `${booking.customer?.name ?? ""} ${booking.customer?.surname ?? ""}`.trim() || "Guest";

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

    const externalId = `channex-${room.booking_room_id}`;
    const checkIn = new Date(room.checkin_date);
    const checkOut = new Date(room.checkout_date);
    const status = room.is_cancelled ? "CANCELLED" : "CONFIRMED";

    const existing = await prisma.reservation.findFirst({ where: { externalId } });

    if (!existing) {
      if (room.is_cancelled) {
        skipped.push(`room ${room.booking_room_id}: already cancelled, nothing to import`);
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
          adults: room.occupancy?.adults ?? 1,
          children: room.occupancy?.children ?? 0,
          totalAmount: room.amount ? Number(room.amount) : undefined,
          currency: booking.currency || listing.property.currency,
          source: mapOtaNameToSource(booking.ota_name),
          status,
        },
      });
      reservationIds.push(reservation.id);

      const gen = await autoGenerateCodesForReservation(reservation.id, listing.propertyId);
      console.log(
        `[channex-bookings] booking ${booking.id} room ${room.booking_room_id}: generated ${gen.codes.length} code(s)` +
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
      const becameCancelled = room.is_cancelled && existing.status !== "CANCELLED";

      await prisma.reservation.update({
        where: { id: existing.id },
        data: {
          status,
          checkIn,
          checkOut,
          adults: room.occupancy?.adults ?? existing.adults,
          children: room.occupancy?.children ?? existing.children,
          totalAmount: room.amount ? Number(room.amount) : existing.totalAmount,
          currency: booking.currency || existing.currency,
        },
      });
      reservationIds.push(existing.id);

      if (becameCancelled) {
        await revokeAccessCodesForReservation(existing.id, listing.property.ownerId);
      } else if (datesChanged && !room.is_cancelled) {
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
