import { prisma } from "@/lib/prisma";
import { channexGet } from "@/lib/channels/channex-core";
import { notifyUser } from "@/lib/notify";
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
  // The REVISION's own id - unique per delivery, different on every create,
  // modify and cancel of the same underlying stay. Confirmed against real
  // data: for one booking modified once, `id` was f33d88c4... on the create
  // and cef89c71... on the modify. Not stable, and not what identifies "the
  // same booking" - see booking_id below for that.
  id: string;
  // The BOOKING's id - the one that stays constant across every revision of
  // it. This, not `id` above, is what a Reservation's externalId must be
  // built from for an update to ever find the row a prior revision created.
  // Confirmed identical (69c36e81-f316-47f5-9ef9-5e3aee66259b) on both the
  // create and the modify revision of the same real booking.
  booking_id: string;
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
  // booking_id specifically, not just any attributes - everything about
  // finding the RIGHT reservation to update depends on it, and a response
  // missing it should fail loudly here rather than silently become
  // "channex-undefined-<listingId>" three call frames away.
  if (!attrs.booking_id) throw new Error(`Channex booking revision ${revisionId} returned no booking_id`);
  return attrs;
}

// Channex's own words on why this is worth a real alert, not a log line:
// "to prevent any potential problems with overbookings, Mapping Issues
// should be solved in short time-frame and should have high priority."
// A booking exists on the OTA either way - if the mapping isn't fixed, it
// never closes the corresponding availability, and the property risks
// double-selling those nights.
export async function notifyUnmappedBooking(
  channexPropertyId: string,
  bookingId: string,
  kind: "room" | "rate"
): Promise<void> {
  const listing = await prisma.channexListing.findFirst({
    where: { channexPropertyId },
    include: { property: { select: { name: true, ownerId: true } } },
  });
  if (!listing) {
    console.warn(`[channex-bookings] unmapped-${kind} event for unrecognised Channex property ${channexPropertyId}`);
    return;
  }

  await notifyUser(listing.property.ownerId, {
    type: "mapping_issue",
    title: `Booking couldn't be mapped — ${listing.property.name}`,
    body:
      kind === "room"
        ? "A new booking arrived that Channex can't match to a room type. Fix the mapping now - until then, this booking won't close out availability, which risks a double booking."
        : "A new booking arrived that Channex can't match to a rate plan. Fix the mapping now - until then, this booking won't close out availability, which risks a double booking.",
    link: "/settings/channels",
  });
  console.warn(`[channex-bookings] unmapped-${kind}: notified owner of ${listing.property.name} (booking ${bookingId})`);
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

// Everything that has to stop happening once a stay is off. Shared by the
// two ways a reservation gets cancelled - the guest cancelling outright, and
// a modification that moves them off this unit - so the door code and the
// cleaner can't be released by one path and left running by the other.
//
// No availability push is needed: the change came from Channex, so it
// already knows, and buildAriValues excludes cancelled stays, which reopens
// those nights on the next push for any reason.
export async function releaseCancelledReservation(reservationId: string, ownerId: string, label: string): Promise<void> {
  await revokeAccessCodesForReservation(reservationId, ownerId);
  // Only PENDING tasks are removed - anything already in progress or
  // completed describes work that actually happened and stays on the record.
  await prisma.cleaningTask.deleteMany({ where: { reservationId, status: "PENDING" } });
  console.log(`[channex-bookings] ${label} cancelled: codes revoked, pending clean removed`);
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
  // Listings this revision does touch, but which StayHQ isn't the owner of
  // yet. Kept apart from "not present" so the orphan sweep below can't read
  // a provider flag as a guest cancelling.
  const offChannexListingIds = new Set<string>();

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
      offChannexListingIds.add(listing.id);
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
    //
    // booking_id, NOT booking.id - the latter is the REVISION's own id and
    // differs on every create, modify and cancel of the same stay. Building
    // this from booking.id was the bug: a real modify created a second
    // reservation instead of updating the first, discovered live when a
    // real Booking.com date change produced a duplicate on a real property.
    const externalId = `channex-${booking.booking_id}-${listing.id}`;
    const checkIn = new Date(Math.min(...rooms.map((r) => new Date(r.checkin_date).getTime())));
    const checkOut = new Date(Math.max(...rooms.map((r) => new Date(r.checkout_date).getTime())));
    const totalAmount = rooms.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0);
    const adults = rooms.reduce((sum, r) => sum + (r.occupancy?.adults ?? 0), 0) || 1;
    const children = rooms.reduce((sum, r) => sum + (r.occupancy?.children ?? 0), 0);
    // Channex marks a cancellation at the REVISION level: status is one of
    // "new", "modified", "cancelled", and that is the authoritative signal.
    // The per-room is_cancelled flag is for partial cancellations, where one
    // room of a multi-room booking is dropped and the rest of the stay
    // stands - it is absent entirely from most cancellation payloads,
    // including every cancelled example in Channex's own docs. Reading only
    // the room flag treated a plain cancellation as still confirmed: nights
    // stayed closed on every channel, the door code stayed live, and a
    // cleaner was still sent for a guest who was not coming.
    //
    // The room flag is still honoured, because a stay whose every room line
    // is cancelled is cancelled even if other rooms on the booking survive.
    const bookingCancelled = (booking.status || "").toLowerCase() === "cancelled";
    const allCancelled = bookingCancelled || rooms.every((r) => r.is_cancelled === true);
    const status = allCancelled ? "CANCELLED" : "CONFIRMED";

    const existing = await prisma.reservation.findFirst({ where: { externalId } });

    if (!existing) {
      if (allCancelled) {
        skipped.push(`booking ${booking.booking_id} / ${listing.property.name}: already cancelled, nothing to import`);
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
        `[channex-bookings] booking ${booking.booking_id} -> ${listing.property.name}: generated ${gen.codes.length} code(s)` +
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
        await releaseCancelledReservation(existing.id, listing.property.ownerId, `booking ${booking.booking_id}`);
      } else if (datesChanged && !allCancelled) {
        await updateAccessCodePeriodsForReservation(existing.id, listing.property.ownerId, checkIn, checkOut);
        await prisma.cleaningTask.updateMany({
          where: { reservationId: existing.id, status: "PENDING" },
          data: { scheduledDate: checkOut },
        });
      }
    }
  }

  // A modification can move a booking onto a different unit, and it arrives
  // as a revision whose rooms[] simply no longer mentions the old one. The
  // reservation created for that old unit would otherwise sit CONFIRMED
  // forever, holding nights the guest gave up - the nights never come back
  // on sale and a cleaner still turns up.
  //
  // Only runs when this revision mapped at least one room. A delivery that
  // mapped nothing is a mapping problem, not a guest changing their mind,
  // and must never be read as one. Listings deliberately skipped because
  // their property isn't on Channex yet are excluded for the same reason.
  if (byListing.size > 0) {
    const stale = await prisma.reservation.findMany({
      where: {
        externalId: { startsWith: `channex-${booking.booking_id}-` },
        status: { not: "CANCELLED" },
      },
      select: { id: true, externalId: true, property: { select: { ownerId: true, name: true } } },
    });

    for (const row of stale) {
      const listingId = (row.externalId ?? "").slice(`channex-${booking.booking_id}-`.length);
      if (byListing.has(listingId) || offChannexListingIds.has(listingId)) continue;

      await prisma.reservation.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
      reservationIds.push(row.id);
      await releaseCancelledReservation(row.id, row.property.ownerId, `booking ${booking.booking_id} moved off ${row.property.name}`);
    }
  }

  return { reservationIds, skipped };
}
