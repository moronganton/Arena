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

// ---------------------------------------------------------------------------
// Save a card now, charge it later - the "eventual future charge" pattern
// from Channex's Payment Application API docs (pre_auth_payment then
// settle_payment), rebuilt directly on Stripe since every endpoint in that
// API is scoped to a Channex booking_id, which a Smoobu-sourced reservation
// (Bratislava, today) will never have. Once Bratislava's properties migrate
// to Channex, they can use the native flow too - this one keeps working
// exactly the same for any property regardless of channel manager.
//
// Two Stripe calls apart from the Checkout Session itself: retrieving the
// completed session with setup_intent.payment_method expanded (the webhook
// payload alone doesn't carry the resulting card's brand/last4), and later
// a server-side PaymentIntent confirmed off_session against that saved
// payment method.
// ---------------------------------------------------------------------------

const CARD_SETUP_REUSE_WINDOW_MS = 23 * 60 * 60 * 1000; // mirrors SESSION_REUSE_WINDOW_MS above

export interface GuestCardOnFileInfo {
  status: string;
  cardBrand: string | null;
  cardLast4: string | null;
}

export async function getGuestCardOnFile(reservationId: string): Promise<GuestCardOnFileInfo | null> {
  const card = await prisma.guestCardOnFile.findUnique({
    where: { reservationId },
    select: { status: true, cardBrand: true, cardLast4: true },
  });
  return card;
}

// Creates (or reuses an open) Checkout Session in "setup" mode: the guest
// enters their card once, nothing is charged, and Stripe hands back a
// reusable PaymentMethod attached to a Customer. Deliberately does NOT
// reuse or touch an existing SAVED card - only a still-open PENDING link -
// so a stray resend can never silently invalidate a card that already
// works.
export async function createOrReuseCardSetupLink(reservationId: string, appUrl: string): Promise<{ url: string }> {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { guest: true, property: true },
  });

  const existing = await prisma.guestCardOnFile.findUnique({ where: { reservationId } });
  // The comment above promises a SAVED card is never touched - this is what
  // actually enforces that. Without it, falling through to create a new
  // session would upsert over the SAVED row below and wipe a card that
  // already works, which is exactly the failure mode auto-charge makes
  // dangerous instead of just awkward.
  if (existing?.status === "SAVED") {
    throw new Error("A card is already saved for this reservation - nothing to send.");
  }
  if (
    existing?.status === "PENDING" &&
    existing.stripeSessionId &&
    existing.updatedAt.getTime() > Date.now() - CARD_SETUP_REUSE_WINDOW_MS
  ) {
    const session = await stripe().checkout.sessions.retrieve(existing.stripeSessionId);
    if (session.status === "open" && session.url) return { url: session.url };
  }

  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    // "setup" mode has no line items to infer eligible payment methods
    // from, so Stripe requires currency explicitly - confirmed live, this
    // call 400'd with "Missing required param: currency" without it.
    currency: reservation.property.currency.toLowerCase(),
    // Without this, a "setup" mode session does not necessarily create a
    // Customer object - confirmed live: the resulting PaymentMethod saved
    // fine, but session.customer came back null, and an off-session charge
    // requires BOTH customer and payment_method. "always" is required here,
    // not optional, for chargeSavedCard() to ever be able to charge this.
    customer_creation: "always",
    customer_email: reservation.guest.email || undefined,
    success_url: `${appUrl}/reservations/${reservationId}?cardSaved=1`,
    cancel_url: `${appUrl}/reservations/${reservationId}?cardSaved=cancelled`,
    metadata: { reservationId },
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");

  await prisma.guestCardOnFile.upsert({
    where: { reservationId },
    create: { reservationId, status: "PENDING", stripeSessionId: session.id },
    update: {
      status: "PENDING",
      stripeSessionId: session.id,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      cardBrand: null,
      cardLast4: null,
    },
  });

  return { url: session.url };
}

// Stripe webhook counterpart to markCityTaxPaid, for a "setup" mode session.
export async function markCardSaved(stripeSessionId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(stripeSessionId, {
    expand: ["setup_intent.payment_method"],
  });
  const setupIntent = session.setup_intent;
  if (!setupIntent || typeof setupIntent === "string") {
    throw new Error(`Checkout session ${stripeSessionId} has no expanded setup_intent`);
  }
  const pm = setupIntent.payment_method && typeof setupIntent.payment_method !== "string" ? setupIntent.payment_method : null;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  await prisma.guestCardOnFile.updateMany({
    where: { stripeSessionId },
    data: {
      status: "SAVED",
      stripeCustomerId: customerId,
      stripePaymentMethodId: pm?.id ?? null,
      cardBrand: pm?.card?.brand ?? null,
      cardLast4: pm?.card?.last4 ?? null,
    },
  });
}

export interface SavedCardChargeResult {
  charge: { id: string; amountCents: number; currency: string; status: string };
}

// Charges the card saved above, with the guest not present. A card that
// requires interactive authentication (3D Secure) for this specific amount
// cannot complete off-session - Stripe returns "authentication_required",
// surfaced here as a clear instruction rather than a bare Stripe error, so
// the host knows to fall back to sendCityTaxLink instead of wondering why a
// "saved" card just failed to charge.
export async function chargeSavedCard(
  reservationId: string,
  amountCents: number,
  description?: string
): Promise<SavedCardChargeResult> {
  if (amountCents <= 0) throw new Error("Amount must be greater than zero");

  const card = await prisma.guestCardOnFile.findUnique({ where: { reservationId } });
  if (!card || card.status !== "SAVED" || !card.stripeCustomerId || !card.stripePaymentMethodId) {
    throw new Error("No saved card on file for this reservation yet");
  }

  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { property: true },
  });
  const nights = nightsBetween(reservation.checkIn, reservation.checkOut);

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe().paymentIntents.create({
      amount: amountCents,
      currency: reservation.property.currency.toLowerCase(),
      customer: card.stripeCustomerId,
      payment_method: card.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: description || `City tax — ${reservation.property.name}`,
      metadata: { reservationId, propertyId: reservation.propertyId },
    });
  } catch (err) {
    const stripeErr = err as { code?: string; message?: string };
    if (stripeErr.code === "authentication_required") {
      throw new Error("The saved card needs the guest to re-authenticate for this charge - send a new payment link instead.");
    }
    throw err instanceof Error ? err : new Error(stripeErr.message || "Charge failed");
  }

  const charge = await prisma.cityTaxCharge.create({
    data: {
      reservationId,
      amountCents,
      currency: reservation.property.currency,
      guests: reservation.adults,
      nights,
      perNightCents: Math.round(amountCents / Math.max(1, nights)),
      stripePaymentIntentId: paymentIntent.id,
      status: paymentIntent.status === "succeeded" ? "PAID" : "PENDING",
      paidAt: paymentIntent.status === "succeeded" ? new Date() : null,
    },
  });

  return { charge: { id: charge.id, amountCents: charge.amountCents, currency: charge.currency, status: charge.status } };
}

// Resolves the [City Tax Card Link] merge field for a template send - real
// link when the host has turned auto-charge on for this property and set a
// rate, empty otherwise. A host can still write that token into a template
// before flipping the toggle on; this is what makes it render as nothing
// rather than a broken link until they do. Errors (e.g. a card already
// saved, Stripe hiccup) are swallowed to "" rather than thrown, so one bad
// link can never take down an entire template send.
export async function resolveCityTaxCardLinkForTemplate(
  reservationId: string,
  property: { cityTaxAutoChargeEnabled: boolean; cityTaxPerNight: number | null },
  appUrl: string
): Promise<string> {
  if (!property.cityTaxAutoChargeEnabled || property.cityTaxPerNight == null) return "";
  try {
    const { url } = await createOrReuseCardSetupLink(reservationId, appUrl);
    return url;
  } catch (err) {
    console.error(`[city-tax] couldn't resolve the auto-send card link for reservation ${reservationId}:`, err);
    return "";
  }
}

export function verifyStripeWebhookSignature(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
