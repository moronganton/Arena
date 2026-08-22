import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

// Bratislava-style local city tax (e.g. 3.5 EUR/guest/night), collected by
// card via a Stripe Checkout link instead of the current manual bank
// transfer nobody can verify without asking the guest directly.
//
// Deliberately NOT routed through Channex's Payment Application API. That
// API only charges against a Channex booking_id (POST /bookings/:id/...,
// confirmed against the real docs) - Bratislava's two properties are
// Smoobu-managed, and a Smoobu-sourced reservation has no Channex booking to
// charge against and never will (Smoobu and Channex are deliberately
// separate booking silos throughout this codebase - see channex-bookings.ts,
// ari-outbox.ts). So this is plain Stripe, works identically for every
// property regardless of which channel manager owns it, and cannot touch
// Smoobu's booking flow at all since it never talks to Smoobu or Channex.
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | null = null;
function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key);
  return client;
}

export interface CityTaxQuote {
  nights: number;
  guests: number;
  perNightCents: number;
  amountCents: number;
  currency: string;
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000));
}

// Adults only by default - many municipalities (Bratislava included, in
// practice) exempt children below some age, and that threshold varies and
// isn't something to hardcode as fact here. The quote is a starting point,
// not a legal calculation - the host can adjust guest count or the total
// before sending, so this never silently over- or under-charges based on an
// assumption this code can't verify.
export function quoteCityTax(property: { cityTaxPerNight: number | null; currency: string }, reservation: { checkIn: Date; checkOut: Date; adults: number }): CityTaxQuote | null {
  if (!property.cityTaxPerNight) return null;
  const nights = nightsBetween(reservation.checkIn, reservation.checkOut);
  const perNightCents = Math.round(property.cityTaxPerNight * 100);
  return {
    nights,
    guests: reservation.adults,
    perNightCents,
    amountCents: perNightCents * nights * reservation.adults,
    currency: property.currency,
  };
}

// Reuses an existing unpaid Checkout Session rather than minting a new one
// every time the host clicks "send link" - Stripe Checkout Sessions expire
// after 24h on their own, so an old PENDING row past that is simply
// abandoned and a fresh one is created.
const SESSION_REUSE_WINDOW_MS = 23 * 60 * 60 * 1000;

export async function createOrReuseCityTaxCharge(
  reservationId: string,
  amountCentsOverride: number | undefined,
  appUrl: string
): Promise<{ url: string; charge: { id: string; amountCents: number; currency: string; status: string } }> {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { property: true, guest: true },
  });

  const pending = await prisma.cityTaxCharge.findFirst({
    where: { reservationId, status: "PENDING", createdAt: { gt: new Date(Date.now() - SESSION_REUSE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (pending?.stripeSessionId) {
    const session = await stripe().checkout.sessions.retrieve(pending.stripeSessionId);
    if (session.status === "open" && session.url) {
      return { url: session.url, charge: { id: pending.id, amountCents: pending.amountCents, currency: pending.currency, status: pending.status } };
    }
  }

  const quote = quoteCityTax(reservation.property, reservation);
  if (!quote && amountCentsOverride === undefined) {
    throw new Error(`${reservation.property.name} has no city tax rate set, and no amount was provided`);
  }
  const amountCents = amountCentsOverride ?? quote!.amountCents;
  if (amountCents <= 0) throw new Error("Amount must be greater than zero");

  const successUrl = `${appUrl}/reservations/${reservationId}?cityTax=paid`;
  const cancelUrl = `${appUrl}/reservations/${reservationId}?cityTax=cancelled`;

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: reservation.property.currency.toLowerCase(),
          unit_amount: amountCents,
          product_data: {
            name: `City tax — ${reservation.property.name}`,
            description: quote
              ? `${quote.nights} night(s) × ${quote.guests} guest(s) × ${(quote.perNightCents / 100).toFixed(2)} ${quote.currency}/guest/night`
              : undefined,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: reservation.guest.email || undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { reservationId, propertyId: reservation.propertyId },
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL");

  const charge = await prisma.cityTaxCharge.create({
    data: {
      reservationId,
      amountCents,
      currency: reservation.property.currency,
      guests: quote?.guests ?? reservation.adults,
      nights: quote?.nights ?? nightsBetween(reservation.checkIn, reservation.checkOut),
      perNightCents: quote?.perNightCents ?? Math.round(amountCents / Math.max(1, nightsBetween(reservation.checkIn, reservation.checkOut))),
      stripeSessionId: session.id,
      status: "PENDING",
    },
  });

  return { url: session.url, charge: { id: charge.id, amountCents: charge.amountCents, currency: charge.currency, status: charge.status } };
}

export async function markCityTaxPaid(stripeSessionId: string, paymentIntentId: string | null): Promise<void> {
  await prisma.cityTaxCharge.updateMany({
    where: { stripeSessionId, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: paymentIntentId },
  });
}

export function verifyStripeWebhookSignature(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
