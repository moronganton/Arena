import { NextRequest, NextResponse } from "next/server";
import { runScheduledMessages } from "@/lib/channels/scheduled-messages";
import { runCityTaxAutoCharge } from "@/lib/city-tax-automation";

// Scheduler: call this on a schedule (hourly is ideal) to send any template
// whose trigger is due for a reservation today. Protect it with the same
// WEBHOOK_SECRET you use for the Smoobu webhook.
//   GET /api/cron/scheduled-messages?secret=YOUR_WEBHOOK_SECRET
//
// The actual work lives in runScheduledMessages (lib/channels/scheduled-
// messages.ts) - shared with scripts/cron/scheduled-messages.ts, the
// Railway-cron-job equivalent of this route. Keep this file as the HTTP-
// triggered path for as long as an external pinger is still in use; once
// fully cut over to Railway's native cron jobs this route can be retired.
//
// Set it up on Railway (cron job hitting this URL) or any external cron pinger.
// Dedupe is enforced by MessageTemplateSend(unique templateId+reservationId),
// so calling it more than once is safe.
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduledMessages();
  // Same cycle, not a separate cron job - a card saved by a template sent
  // in this same run only becomes chargeable next cycle anyway (the webhook
  // fires after this request returns), so there's no reason to run more
  // often than the template scheduler already does.
  const cityTaxAutoCharge = await runCityTaxAutoCharge();
  return NextResponse.json({ ...result, cityTaxAutoCharge });
}
