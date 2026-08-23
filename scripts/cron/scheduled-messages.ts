import { prisma } from "@/lib/prisma";
import { runScheduledMessages } from "@/lib/channels/scheduled-messages";
import { runCityTaxAutoCharge } from "@/lib/city-tax-automation";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/scheduled-messages. Hourly is ideal.
// Dedupe is enforced by MessageTemplateSend(unique templateId+reservationId),
// so calling this more than once is safe - including alongside the HTTP
// route, if both are ever scheduled during a transition period.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("scheduled-messages", async () => {
    const r = await runScheduledMessages();
    const c = await runCityTaxAutoCharge();
    return {
      templatesChecked: r.templatesChecked,
      sent: r.sent,
      cetHour: r.cetHour,
      cetDate: r.cetDate,
      cityTaxChecked: c.checked,
      cityTaxCharged: c.charged,
      cityTaxFailed: c.failed,
    };
  });
  console.log(`[cron/scheduled-messages] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/scheduled-messages] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
