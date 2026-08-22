import { prisma } from "@/lib/prisma";
import { syncAllSmoobuMessages } from "@/lib/channels/smoobu-provider";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/sync-messages. Every 2-3 minutes is
// ideal - guest replies happen 24/7 without waiting for a host to open a
// thread or for a reservation webhook to fire.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("sync-messages", async () => {
    const r = await syncAllSmoobuMessages();
    // Every connected account failing is an outage worth surfacing; one
    // among several erroring is already logged above.
    if (r.accounts > 0 && r.errors.length >= r.accounts) {
      throw new Error(r.errors.join("; "));
    }
    return { accounts: r.accounts, reservationsChecked: r.reservationsChecked, newMessages: r.newMessages, errors: r.errors.length };
  });
  console.log(`[cron/sync-messages] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/sync-messages] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
