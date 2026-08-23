import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// Reports only presence/length of the Stripe env vars, never the values -
// same pattern as channex-probe's apiKeyPresent/apiKeyLength - so whether
// Railway has these set is diagnosable without leaking a secret.
//
//   GET /api/debug/stripe-config-check
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const properties = await prisma.property.findMany({
    where: { ownerId: access.userId },
    select: { id: true, name: true, cityTaxPerNight: true, channelProvider: true },
  });

  return NextResponse.json({
    stripeSecretKeyPresent: !!secretKey,
    stripeSecretKeyPrefix: secretKey ? secretKey.slice(0, 7) : null, // "sk_test" vs "sk_live", nothing sensitive
    stripeWebhookSecretPresent: !!webhookSecret,
    properties: properties.map((p) => ({
      name: p.name,
      channelProvider: p.channelProvider,
      cityTaxPerNight: p.cityTaxPerNight,
    })),
  });
}
