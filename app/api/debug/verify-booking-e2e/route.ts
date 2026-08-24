import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet } from "@/lib/channels/channex-core";

// One request that answers "did this booking land correctly, and did every
// downstream effect actually fire?" - built while validating the first real
// Airbnb reservation, but deliberately channel-agnostic: the same checks are
// what you want for a new OTA, a new channel manager, or a regression after
// touching the booking path.
//
// Reads only. Nothing here mutates a reservation, a lock, or Channex.
//
//   GET /api/debug/verify-booking-e2e?reservationId=...
//   GET /api/debug/verify-booking-e2e?confirmationCode=ABB-HMMC4NDXQZ
//   GET /api/debug/verify-booking-e2e?latest=true          -> newest reservation
//   GET /api/debug/verify-booking-e2e?latest=true&source=AIRBNB
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const confirmationCode = searchParams.get("confirmationCode");
  const source = searchParams.get("source");
  const latest = searchParams.get("latest") === "true";

  const where = reservationId
    ? { id: reservationId }
    : confirmationCode
      ? { confirmationCode }
      : latest
        ? { ...(source ? { source } : {}), property: { ownerId: access.userId } }
        : null;
  if (!where) {
    return NextResponse.json({ error: "Pass reservationId, confirmationCode, or latest=true" }, { status: 400 });
  }

  const reservation = await prisma.reservation.findFirst({
    where: { ...where, property: { ownerId: access.userId } },
    orderBy: { createdAt: "desc" },
    include: {
      guest: true,
      property: { include: { channexListing: true, locks: true } },
      accessCodes: { include: { lock: { select: { name: true } } } },
      cleaningTasks: true,
      messages: { orderBy: { createdAt: "asc" } },
      cityTaxCharges: true,
      guestCardOnFile: true,
    },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(reservation.checkIn);
  // ARI closes the nights slept, i.e. up to but not including checkout.
  const lastNight = new Date(reservation.checkOut.getTime() - 86400000);
  const to = iso(lastNight);

  // The single most important check: are the booked nights actually closed
  // on Channex's side? Everything else is bookkeeping - this is the one that
  // prevents selling the same night twice on another channel.
  const ariNights: Array<Record<string, unknown>> = [];
  let ariError: string | null = null;
  const listing = reservation.property.channexListing;
  if (listing) {
    // Walk each booked night rather than the range, so a single night that
    // failed to close is visible instead of averaged away.
    for (let t = reservation.checkIn.getTime(); t <= lastNight.getTime(); t += 86400000) {
      const date = iso(new Date(t));
      const q = (o: Record<string, string>) =>
        Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
      try {
        const [avail, restr] = await Promise.all([
          channexGet(
            `/availability?${q({
              "filter[property_id]": listing.channexPropertyId,
              "filter[room_type_id]": listing.channexRoomTypeId,
              "filter[date]": date,
            })}`
          ),
          channexGet(
            `/restrictions?${q({
              "filter[property_id]": listing.channexPropertyId,
              "filter[room_type_id]": listing.channexRoomTypeId,
              "filter[rate_plan_id]": listing.channexRatePlanId,
              "filter[date]": date,
              "filter[restrictions][]": "stop_sell",
            })}`
          ),
        ]);
        ariNights.push({ date, availability: avail.data, restrictions: restr.data });
      } catch (err) {
        ariError = err instanceof Error ? err.message : String(err);
        break;
      }
    }
  }

  const outbox = await prisma.ariOutbox.findMany({
    where: { propertyId: reservation.propertyId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, dateFrom: true, dateTo: true, kind: true, status: true, attempts: true, lastError: true, createdAt: true },
  });

  return NextResponse.json({
    reservation: {
      id: reservation.id,
      source: reservation.source,
      status: reservation.status,
      confirmationCode: reservation.confirmationCode,
      externalId: reservation.externalId,
      checkIn: from,
      checkOut: iso(reservation.checkOut),
      nights: Math.round((reservation.checkOut.getTime() - reservation.checkIn.getTime()) / 86400000),
      adults: reservation.adults,
      children: reservation.children,
      totalAmount: reservation.totalAmount,
      currency: reservation.currency,
      createdAt: reservation.createdAt,
    },
    property: {
      name: reservation.property.name,
      channelProvider: reservation.property.channelProvider,
      hasChannexListing: !!reservation.property.channexListing,
      lockCount: reservation.property.locks.length,
      cityTaxPerNight: reservation.property.cityTaxPerNight,
    },
    // Airbnb withholds real contact details and substitutes a relay address,
    // so nulls here are expected rather than a fault - surfaced explicitly
    // because a null email silently disables the email delivery fallback.
    guest: {
      name: reservation.guest.name,
      email: reservation.guest.email,
      phone: reservation.guest.phone,
      hasEmail: !!reservation.guest.email,
      hasPhone: !!reservation.guest.phone,
    },
    sideEffects: {
      accessCodes: reservation.accessCodes.map((c) => ({
        code: c.code,
        lock: c.lock.name,
        validFrom: c.validFrom,
        validTo: c.validTo,
        isActive: c.isActive,
        sentToGuest: c.sentToGuest,
        ttlockKeyId: c.ttlockKeyId,
      })),
      cleaningTasks: reservation.cleaningTasks.map((t) => ({
        status: t.status,
        scheduledDate: t.scheduledDate,
      })),
      messages: reservation.messages.map((m) => ({
        direction: m.direction,
        channel: m.channel,
        source: m.source,
        isAiGenerated: m.isAiGenerated,
        channelFailed: m.channelFailed,
        channelError: m.channelError,
        createdAt: m.createdAt,
        preview: m.body.slice(0, 90),
      })),
      cityTaxCharges: reservation.cityTaxCharges.map((c) => ({ status: c.status, amountCents: c.amountCents })),
      cardOnFile: reservation.guestCardOnFile ? reservation.guestCardOnFile.status : null,
    },
    availability: {
      checkedRange: { from, to },
      note: "availability 0 / stop_sell true on every night = correctly closed to other channels",
      nightsChecked: ariNights.length,
      channexReadBack: ariNights,
      readError: ariError,
      recentOutbox: outbox,
    },
  });
}
