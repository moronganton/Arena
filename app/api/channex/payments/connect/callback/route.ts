import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listPaymentProviders, savePaymentSetup } from "@/lib/channels/channex-payments";
import { resolveAppOrigin } from "@/lib/app-url";

// Where Stripe/Channex redirect the host back to once the OAuth connect flow
// finishes (see initiateStripeConnect's redirect_url). No documented query
// params carry success/failure here, so this just re-checks whether a
// provider now exists for the installation and saves it - the same check
// GET /api/channex/payments/setup already does, reused so there is exactly
// one place that decides "is Stripe connected."
//
//   GET /api/channex/payments/connect/callback?propertyId=...
export async function GET(req: NextRequest) {
  const propertyId = new URL(req.url).searchParams.get("propertyId");
  // Built from resolveAppOrigin, not req.url directly - behind Railway's
  // proxy req.url resolves to the app's internal bind address
  // (http://localhost:8080), which is exactly what leaked into a real
  // redirect here before this fix.
  const settingsUrl = new URL("/settings/listing-content", resolveAppOrigin(req));
  if (!propertyId) {
    settingsUrl.searchParams.set("paymentSetup", "error");
    return NextResponse.redirect(settingsUrl);
  }

  const listing = await prisma.channexListing.findUnique({
    where: { propertyId },
    select: { paymentInstallationId: true },
  });
  if (!listing?.paymentInstallationId) {
    settingsUrl.searchParams.set("paymentSetup", "error");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const providers = await listPaymentProviders(listing.paymentInstallationId);
    const stripeProvider = providers.find((p) => p.provider === "stripe");
    if (stripeProvider) {
      await savePaymentSetup(propertyId, listing.paymentInstallationId, stripeProvider.id);
      settingsUrl.searchParams.set("paymentSetup", "connected");
    } else {
      settingsUrl.searchParams.set("paymentSetup", "pending");
    }
  } catch {
    settingsUrl.searchParams.set("paymentSetup", "error");
  }

  return NextResponse.redirect(settingsUrl);
}
