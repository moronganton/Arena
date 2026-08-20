import { NextRequest, NextResponse } from "next/server";
import { drainAriOutbox } from "@/lib/channels/ari-drain";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

// Drains queued AriOutbox rows into batched Channex calls: coalesces
// overlapping date ranges per property, paces calls to stay under Channex's
// ~20/minute limit, and backs off exponentially on failure rather than
// hammering a persistent error every run. See lib/channels/ari-drain.ts for
// the actual logic - this route is deliberately thin.
//
// Fires in the BACKGROUND and responds immediately, the same reasoning as
// cron/sync-reservations: pacing at ~3.5s between calls for up to 15 calls
// can take the better part of a minute, well past what free cron pingers
// commonly allow (30s), and this app runs as a persistent `next start`
// process on Railway, not a serverless function frozen the instant a
// response is sent - the event loop keeps draining after the HTTP response
// goes out. Results aren't visible to the caller this way, so everything is
// logged instead; check Railway's logs for "[cron/drain-ari]".
//
// Call on a schedule (every 1-2 minutes is reasonable), protected by
// WEBHOOK_SECRET:
//   GET /api/cron/drain-ari?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("drain-ari", async () => {
    const summary = await drainAriOutbox();
    // A run that could not complete any of its calls is a failure worth
    // surfacing; partial failures are already retried by the outbox itself.
    if (summary.callsMade > 0 && summary.callsSucceeded === 0) {
      throw new Error(`all ${summary.callsMade} push(es) to Channex failed`);
    }
    return {
      eligibleRows: summary.eligibleRows,
      propertiesTouched: summary.propertiesTouched,
      callsMade: summary.callsMade,
      callsSucceeded: summary.callsSucceeded,
      callsFailed: summary.callsFailed,
      rowsDone: summary.rowsDone,
      rowsFailedTerminally: summary.rowsFailedTerminally,
      stoppedEarly: summary.stoppedEarly,
    };
  });
}
