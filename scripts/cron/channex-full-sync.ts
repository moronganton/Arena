import { prisma } from "@/lib/prisma";
import { runFullSyncForAllChannexProperties } from "@/lib/channels/channex-ari";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/channex-full-sync. Channex allows a
// full sync "once every 24h if required but please schedule this on off peak
// hours" (certification test 13) - schedule this Railway Cron Job accordingly:
// once daily, off-peak.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("channex-full-sync", async () => {
    const r = await runFullSyncForAllChannexProperties();
    if (r.totalFailed > 0 && r.totalTaskIds === 0) {
      throw new Error(`all ${r.propertiesSynced} propert${r.propertiesSynced === 1 ? "y" : "ies"} failed to sync`);
    }
    return {
      propertiesSynced: r.propertiesSynced,
      totalTaskIds: r.totalTaskIds,
      totalFailed: r.totalFailed,
    };
  });
  console.log(`[cron/channex-full-sync] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/channex-full-sync] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
