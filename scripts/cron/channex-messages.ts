import { prisma } from "@/lib/prisma";
import { pollChannexMessages } from "@/lib/channels/channex-messages";
import { runCronJobToCompletion, closeStaleCronRuns } from "@/lib/cron-run";

// One-shot equivalent of GET /api/cron/channex-messages. This is not a
// safety net, it is the only inbound route for Channex guest messages - the
// registered webhook has never delivered one. Every 5-10 minutes is
// appropriate; hourly is too slow for a guest waiting on an answer.
async function main() {
  await closeStaleCronRuns();
  const summary = await runCronJobToCompletion("channex-messages", async () => {
    const r = await pollChannexMessages();
    if (r.errors.length) throw new Error(r.errors.join("; "));
    return { checked: r.reservationsChecked, imported: r.imported, unsupported: r.unsupported };
  });
  console.log(`[cron/channex-messages] ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("[cron/channex-messages] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
