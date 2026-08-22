import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { ensurePaymentAppInstalled, initiateStripeConnect, listPaymentProviders } from "@/lib/channels/channex-payments";
import { ChannexError } from "@/lib/channels/channex-core";

// One-time setup: install the Payment app, then connect the property's own
// Stripe account via OAuth. GET reports current status; POST starts (or
// restarts) the Stripe connect step.
//
//   GET  /api/channex/payments/setup?propertyId=...
//   POST /api/channex/payments/setup   { propertyId }  -> { connectUrl }
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!guard.paymentInstallationId) {
    return NextResponse.json({ property: guard.propertyName, installed: false, connected: false, providers: [] });
  }

  try {
    const providers = await listPaymentProviders(guard.paymentInstallationId);
    return NextResponse.json({
      property: guard.propertyName,
      installed: true,
      connected: providers.some((p) => p.provider === "stripe"),
      providers,
    });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL;
  if (!appUrl) return NextResponse.json({ error: "NEXTAUTH_URL is not set - needed to build the Stripe redirect URL" }, { status: 500 });

  try {
    const installationId = await ensurePaymentAppInstalled(guard.channexPropertyId);
    // Persisted immediately, before the redirect - the callback needs to
    // find the ChannexListing to know which provider connected, and it has
    // no other way back to the propertyId once Stripe redirects here.
    await prisma.channexListing.update({ where: { propertyId }, data: { paymentInstallationId: installationId } });

    const redirectUrl = `${appUrl}/api/channex/payments/connect/callback?propertyId=${propertyId}`;
    const connectUrl = await initiateStripeConnect(installationId, redirectUrl, guard.propertyName);
    return NextResponse.json({ connectUrl });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status || 502 });
  }
}
