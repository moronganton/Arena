import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexBookingIdFromExternalId } from "@/lib/channels/channex-messages";
import { channexPost, ChannexError } from "@/lib/channels/channex-core";

// The real "Charge card (via Channex)" call just returned a raw 500
// (Internal Server Error) from Channex itself, not a validation error - this
// tries a few payload variants against the same booking to see whether it's
// something about our request shape (e.g. amount "1" vs "1.00") or a genuine
// Channex-side failure regardless of shape.
//
//   GET /api/debug/channex-charge-probe?reservationId=<id>
function describeError(err: unknown): unknown {
  const e = err as ChannexError;
  if (e instanceof Error) return { message: e.message, status: e.status, code: e.code, details: e.details };
  return String(err);
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: access.userId } },
    include: { property: { include: { channexListing: true } } },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  const listing = reservation.property.channexListing;
  const bookingId = reservation.externalId ? channexBookingIdFromExternalId(reservation.externalId) : null;

  const results: Record<string, unknown> = {
    bookingId,
    paymentInstallationId: listing?.paymentInstallationId ?? null,
    paymentProviderId: listing?.paymentProviderId ?? null,
  };
  if (!bookingId || !listing?.paymentProviderId) {
    return NextResponse.json({ ...results, verdict: "Missing bookingId or paymentProviderId - stopped before calling Channex." });
  }

  // Variant 1: exactly what the production route sends ("1", no decimals).
  try {
    const res = await channexPost(`/bookings/${bookingId}/charge_payment`, {
      booking_id: bookingId,
      payment_provider_id: listing.paymentProviderId,
      amount: "1",
      description: "probe - bare integer amount",
    });
    results.bareIntegerAmount = { ok: true, res };
  } catch (err) {
    results.bareIntegerAmount = { ok: false, error: describeError(err) };
  }

  // Variant 2: two-decimal amount, matching every example in the docs.
  try {
    const res = await channexPost(`/bookings/${bookingId}/charge_payment`, {
      booking_id: bookingId,
      payment_provider_id: listing.paymentProviderId,
      amount: "1.00",
      description: "probe - decimal amount",
    });
    results.decimalAmount = { ok: true, res };
  } catch (err) {
    results.decimalAmount = { ok: false, error: describeError(err) };
  }

  return NextResponse.json(results);
}
