import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channexBookingIdFromExternalId } from "@/lib/channels/channex-messages";
import {
  chargePayment,
  preAuthPayment,
  settlePayment,
  voidPayment,
  refundPayment,
  listPaymentTransactions,
} from "@/lib/channels/channex-payments";
import { ChannexError } from "@/lib/channels/channex-core";

// Charges, refunds, and reads payment history for ONE reservation. Only
// reachable for a reservation whose externalId is Channex-sourced
// ("channex-...") - a Smoobu reservation has no Channex booking_id to charge
// against at all, so this 400s rather than silently doing nothing.
//
//   GET  /api/channex/payments?reservationId=...
//   POST /api/channex/payments   { reservationId, action, amount?, description?, paymentId? }
//     action: "charge" | "pre_auth" | "settle" | "void" | "refund"
async function resolveReservation(reservationId: string, ownerId: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId } },
    include: { property: { include: { channexListing: true } } },
  });
  if (!reservation) return { error: "Reservation not found", status: 404 } as const;
  if (reservation.property.channelProvider !== "CHANNEX" || !reservation.property.channexListing) {
    return { error: `${reservation.property.name} isn't on Channex`, status: 400 } as const;
  }
  const listing = reservation.property.channexListing;
  if (!listing.paymentInstallationId || !listing.paymentProviderId) {
    return { error: "Payments aren't set up for this property yet - connect Stripe first", status: 400 } as const;
  }
  const bookingId = reservation.externalId ? channexBookingIdFromExternalId(reservation.externalId) : null;
  if (!bookingId) {
    return { error: "This reservation has no Channex booking to charge - it wasn't sourced from Channex", status: 400 } as const;
  }
  return { reservation, bookingId, installationId: listing.paymentInstallationId, providerId: listing.paymentProviderId } as const;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const resolved = await resolveReservation(reservationId, session.user.id);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  try {
    const all = await listPaymentTransactions(resolved.installationId);
    const transactions = all.filter((t) => t.booking_id === resolved.bookingId);
    return NextResponse.json({ currency: resolved.reservation.currency, transactions });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { reservationId, action, amount, description, paymentId } = body as {
    reservationId?: string;
    action?: string;
    amount?: string;
    description?: string;
    paymentId?: string;
  };
  if (!reservationId || !action) return NextResponse.json({ error: "reservationId and action are required" }, { status: 400 });

  const resolved = await resolveReservation(reservationId, session.user.id);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { bookingId, providerId } = resolved;

  try {
    switch (action) {
      case "charge": {
        if (!amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
        const payment = await chargePayment(bookingId, providerId, amount, description || "StayHQ charge");
        return NextResponse.json({ payment });
      }
      case "pre_auth": {
        if (!amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
        const payment = await preAuthPayment(bookingId, providerId, amount, description || "StayHQ pre-authorization");
        return NextResponse.json({ payment });
      }
      case "settle": {
        if (!paymentId) return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
        const payment = await settlePayment(bookingId, paymentId);
        return NextResponse.json({ payment });
      }
      case "void": {
        if (!paymentId) return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
        const payment = await voidPayment(bookingId, paymentId);
        return NextResponse.json({ payment });
      }
      case "refund": {
        if (!paymentId || !amount) return NextResponse.json({ error: "paymentId and amount are required" }, { status: 400 });
        const payment = await refundPayment(bookingId, paymentId, amount);
        return NextResponse.json({ payment });
      }
      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status || 502 });
  }
}
