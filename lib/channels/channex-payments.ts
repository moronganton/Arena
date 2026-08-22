import { prisma } from "@/lib/prisma";
import { channexGet, channexPost } from "./channex-core";

// Channex's Payment Application: charges a guest's card through Stripe
// without StayHQ ever touching card data or PCI scope, via Channex acting as
// the Stripe Connect intermediary.
//
// CRITICAL SCOPE LIMIT, confirmed against the real docs (docs.channex.io/
// api-v.1-documentation/payment-application-api): every payment call here is
// POST /bookings/:booking_id/... - a CHANNEX booking id. A Smoobu-sourced
// reservation has no such id and never will (Smoobu and Channex are
// deliberately separate booking silos throughout this codebase). This is
// therefore usable ONLY for Channex-provisioned properties (today: Sinteu),
// never for the Bratislava/Smoobu properties - not by a guard added here,
// but because there is no booking on Channex's side to charge against. See
// lib/city-tax.ts for the actual Bratislava city-tax solution, which is
// plain Stripe and does not go through Channex at all.

const PAYMENT_APP_CODE = "channex_payments";

export interface PaymentInstallation {
  id: string;
  property_id: string;
  application_code: string;
}

// Idempotent: checks installed apps first rather than attempting a blind
// install every time, since a second install call for an already-installed
// app is unnecessary API surface to depend on behaving safely.
export async function ensurePaymentAppInstalled(channexPropertyId: string): Promise<string> {
  const listRes = await channexGet<Array<{ id: string; attributes: PaymentInstallation }>>("/applications/installed");
  const existing = (listRes.data ?? []).find(
    (a) => a.attributes.property_id === channexPropertyId && a.attributes.application_code === PAYMENT_APP_CODE
  );
  if (existing) return existing.id;

  const res = await channexPost<{ id: string; attributes: PaymentInstallation }>("/applications/install", {
    application_installation: { property_id: channexPropertyId, application_code: PAYMENT_APP_CODE },
  });
  if (!res.data) throw new Error("Channex returned no data installing the Payment app");
  return res.data.id;
}

// Step 2 of setup: connect the property's own Stripe account via OAuth.
// Returns a link to redirect the host to; Stripe redirects back to
// redirectUrl once they finish. There is no documented "poll for completion"
// call - the caller re-fetches listPaymentProviders after the redirect
// lands to see whether a provider now exists.
export async function initiateStripeConnect(installationId: string, redirectUrl: string, title: string): Promise<string> {
  const res = await channexPost<{ link: string }>(`/applications/payment_app/${installationId}/connect`, {
    provider: "stripe",
    title,
    redirect_url: redirectUrl,
  });
  if (!res.data?.link) throw new Error("Channex did not return a Stripe connect link");
  return res.data.link;
}

export interface PaymentProvider {
  id: string;
  title: string;
  provider: string;
  is_active: boolean;
  is_default: boolean;
  details: { account_id?: string };
}

export async function listPaymentProviders(installationId: string): Promise<PaymentProvider[]> {
  const res = await channexPost<Array<{ id: string; attributes: PaymentProvider }>>(
    `/applications/payment_app/${installationId}/providers`,
    { page: 1, limit: 25 }
  );
  return (res.data ?? []).map((p) => p.attributes);
}

export async function setDefaultPaymentProvider(installationId: string, providerId: string): Promise<void> {
  await channexPost(`/applications/payment_app/${installationId}/set_provider_as_default`, { id: providerId });
}

export interface ChannexTransaction {
  id: string;
  type: "charge" | "refund" | "pre_auth" | "void";
  currency: string;
  amount: string;
  inserted_at: string;
  booking_id: string;
  payment_provider_id?: string;
}

export interface ChannexPayment {
  id: string;
  status: "charged" | "refunded" | "pre_authorized" | "cancelled" | "partially_refunded";
  description: string;
  currency: string;
  amount: string;
  booking_id: string;
  transactions: ChannexTransaction[];
}

async function paymentCall(path: string, body: unknown): Promise<ChannexPayment> {
  const res = await channexPost<{ attributes: ChannexPayment }>(path, body);
  if (!res.data) throw new Error("Channex returned no data for the payment operation");
  return res.data.attributes;
}

// amount is always a decimal string in the booking's own currency ("10.00"),
// per Channex's documented shape - not minor units, unlike the ARI push path
// elsewhere in this codebase which does use cents. Two different Channex
// APIs, two different conventions - kept as-is rather than normalized, so
// callers match whichever docs page they're reading.
export function chargePayment(bookingId: string, providerId: string, amount: string, description: string): Promise<ChannexPayment> {
  return paymentCall(`/bookings/${bookingId}/charge_payment`, {
    booking_id: bookingId,
    payment_provider_id: providerId,
    amount,
    description,
  });
}

export function preAuthPayment(bookingId: string, providerId: string, amount: string, description: string): Promise<ChannexPayment> {
  return paymentCall(`/bookings/${bookingId}/pre_auth_payment`, {
    booking_id: bookingId,
    payment_provider_id: providerId,
    amount,
    description,
  });
}

export function settlePayment(bookingId: string, paymentId: string): Promise<ChannexPayment> {
  return paymentCall(`/bookings/${bookingId}/settle_payment`, { payment_id: paymentId });
}

export function voidPayment(bookingId: string, paymentId: string): Promise<ChannexPayment> {
  return paymentCall(`/bookings/${bookingId}/void_payment`, { payment_id: paymentId });
}

export function refundPayment(bookingId: string, paymentId: string, amount: string): Promise<ChannexPayment> {
  return paymentCall(`/bookings/${bookingId}/refund_payment`, { payment_id: paymentId, amount });
}

export interface ChannexTransactionWithPaymentId extends ChannexTransaction {
  paymentId: string | null; // relationships.payment.data.id - not in attributes
}

// Reporting API - the source of truth for "who paid" on Channex-managed
// bookings, rather than a local mirror that could drift from what Stripe/
// Channex actually processed.
export async function listPaymentTransactions(installationId: string): Promise<ChannexTransactionWithPaymentId[]> {
  const res = await channexPost<Array<{ attributes: ChannexTransaction; relationships?: { payment?: { data?: { id?: string } } } }>>(
    `/applications/payment_app/${installationId}/transactions`,
    { pagination: { page: 1, limit: 100 }, order: { inserted_at: "desc" }, filter: {} }
  );
  return (res.data ?? []).map((t) => ({ ...t.attributes, paymentId: t.relationships?.payment?.data?.id ?? null }));
}

// Persists the installation/provider ids on ChannexListing once setup
// completes, so every later payment call can look them up without re-hitting
// Channex's setup endpoints on every request.
export async function savePaymentSetup(propertyId: string, installationId: string, providerId: string): Promise<void> {
  await prisma.channexListing.update({
    where: { propertyId },
    data: { paymentInstallationId: installationId, paymentProviderId: providerId },
  });
}
