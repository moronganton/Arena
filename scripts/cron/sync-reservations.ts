import { prisma } from "@/lib/prisma";
import { syncAllSmoobuReservations } from "@/lib/channels/smoobu-provider";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/sync-reservations. Hourly is enough -
// commission tracking is not time-critical the way messages are.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("sync-reservations", async () => {
    const r = await syncAllSmoobuReservations();
    // Every connected account failing is an outage worth reporting; one
    // account erroring among several is not, and is already logged above.
    if (r.accounts > 0 && r.errors.length >= r.accounts) {
      throw new Error(r.errors.join("; "));
    }
    return { accounts: r.accounts, imported: r.imported, updated: r.updated, cancelled: r.cancelled, errors: r.errors.length };
  });
  console.log(`[cron/sync-reservations] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/sync-reservations] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
