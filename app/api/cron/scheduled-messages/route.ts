import { NextRequest, NextResponse } from "next/server";
import { runScheduledMessages } from "@/lib/channels/scheduled-messages";
import { runCityTaxAutoCharge } from "@/lib/city-tax-automation";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

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
//
// Records a CronRun like every sibling route. It did not, and the effect was
// worse than missing data: cron-health reported "never run" while the job was
// in fact running hourly and sending guest messages perfectly well. A signal
// pinned to a constant is more dangerous than no signal, because it reads as
// information - and it meant the one state that mattered, this job genuinely
// stopping, was indistinguishable from the state it was already in.
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("scheduled-messages", async () => {
    const result = await runScheduledMessages();
    // Same cycle, not a separate cron job - a card saved by a template sent
    // in this same run only becomes chargeable next cycle anyway (the webhook
    // fires after this request returns), so there's no reason to run more
    // often than the template scheduler already does.
    const cityTaxAutoCharge = await runCityTaxAutoCharge();
    return { ...result, cityTaxAutoCharge };
  });
}
