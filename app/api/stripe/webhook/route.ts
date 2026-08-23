import { NextRequest, NextResponse } from "next/server";
import { verifyStripeWebhookSignature, markCityTaxPaid, markCardSaved } from "@/lib/city-tax";
import type Stripe from "stripe";

// Stripe's own recommended pattern (unlike the Channex webhook elsewhere in
// this app, which always returns 200 to avoid Channex disabling it after
// repeated failures): 200 acknowledges receipt, a non-2xx tells Stripe to
// retry for up to 3 days. For a payment record, a transient DB failure is
// exactly the case retries exist for - swallowing it into a 200 would leave
// a guest's payment collected by Stripe but never marked paid in StayHQ,
// with no second chance to fix it.
//
//   POST /api/stripe/webhook
// Configure in the Stripe dashboard: Developers -> Webhooks -> this URL,
// event: checkout.session.completed.
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "setup") {
        await markCardSaved(session.id);
        console.log(`[stripe-webhook] card saved: session ${session.id}`);
      } else {
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
        await markCityTaxPaid(session.id, paymentIntentId);
        console.log(`[stripe-webhook] city tax paid: session ${session.id}`);
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] failed to process event:", event.type, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
