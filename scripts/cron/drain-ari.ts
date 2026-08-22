import { prisma } from "@/lib/prisma";
import { drainAriOutbox } from "@/lib/channels/ari-drain";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/drain-ari, for Railway's native Cron
// Jobs: a fresh container runs this to completion and exits, instead of
// firing work in the background on the persistent web process and relying on
// an external pinger's timeout tolerance. See lib/channels/ari-drain.ts for
// what actually happens - this file is just the entry point + exit code.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("drain-ari", async () => {
    const s = await drainAriOutbox();
    if (s.callsMade > 0 && s.callsSucceeded === 0) {
      throw new Error(`all ${s.callsMade} push(es) to Channex failed`);
    }
    return {
      eligibleRows: s.eligibleRows,
      propertiesTouched: s.propertiesTouched,
      callsMade: s.callsMade,
      callsSucceeded: s.callsSucceeded,
      callsFailed: s.callsFailed,
      rowsDone: s.rowsDone,
      rowsFailedTerminally: s.rowsFailedTerminally,
      stoppedEarly: s.stoppedEarly,
    };
  });
  console.log(`[cron/drain-ari] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/drain-ari] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
