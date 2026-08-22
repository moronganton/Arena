import { prisma } from "@/lib/prisma";
import { pollChannexRevisions } from "@/lib/channels/channex-revisions";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/channex-revisions. Hourly is enough.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("channex-revisions", async () => {
    const r = await pollChannexRevisions();
    if (r.errors.length) throw new Error(r.errors.join("; "));
    return {
      fetched: r.fetched,
      reservationsTouched: r.reservationsTouched,
      acknowledged: r.acknowledged,
      skippedButAcknowledged: r.skippedButAcknowledged,
      leftForRetry: r.leftForRetry,
    };
  });
  console.log(`[cron/channex-revisions] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/channex-revisions] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
