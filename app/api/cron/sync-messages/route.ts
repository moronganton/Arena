import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { smoobuProvider } from "@/lib/channels/smoobu-provider";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

// Continuously pulls new guest messages from Smoobu for all accounts and runs
// each through the AI — so replies happen 24/7 without waiting for the host to
// open a thread or for a reservation webhook to fire.
//
// Runs in the BACKGROUND and answers immediately, for the same reason
// sync-reservations does: free cron pingers cap the request at 30 seconds
// (confirmed against cron-job.org's own UI), and checking every reservation
// on every Smoobu account routinely takes longer than that. This route used
// to await the whole sync before replying, so it timed out on every single
// tick - the pinger recorded "Failed (timeout, 30s)" while the sync itself
// carried on server-side, meaning the job looked broken AND its real
// failures were invisible. Safe here specifically because this runs as a
// persistent `next start` process on Railway, not a serverless function
// frozen the moment a response is sent.
//
// startCronRun also makes a genuinely failing run visible: the response
// carries the PREVIOUS run's outcome, so the pinger's own failure
// notification works, one cycle late.
//
// Call on a schedule (every 2–3 minutes is ideal), protected by WEBHOOK_SECRET:
//   GET /api/cron/sync-messages?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("sync-messages", runSync);
}

async function runSync() {
  const started = Date.now();
  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });

  let reservationsChecked = 0;
  let newMessages = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      const r = await smoobuProvider.syncMessages(account.userId);
      reservationsChecked += r.checked;
      newMessages += r.newMessages;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/sync-messages] account ${account.userId} failed:`, err);
      errors.push(`${account.userId}: ${msg}`);
    }
  }

  console.log(
    `[cron/sync-messages] done in ${Date.now() - started}ms - accounts=${accounts.length} ` +
      `checked=${reservationsChecked} new=${newMessages} errors=${errors.length}`
  );

  // Every connected account failing is an outage worth surfacing; one among
  // several erroring is already logged above. Same rule sync-reservations uses.
  if (accounts.length > 0 && errors.length >= accounts.length) {
    throw new Error(errors.join("; "));
  }

  return { accounts: accounts.length, reservationsChecked, newMessages, errors: errors.length };
}
