import { NextRequest, NextResponse } from "next/server";
import { syncAllSmoobuReservations } from "@/lib/channels/smoobu-provider";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

// Runs syncSmoobuBookings for every connected account on a schedule, instead
// of relying only on Smoobu's webhook (fires on booking changes) or a host
// manually clicking "Import Now" on Settings -> Smoobu.
//
// This exists specifically so platformCommissionSeenAt (Reservation) means
// something: Smoobu appears to backfill commission-included sometime after a
// booking first appears, not at creation, and that value is not something a
// booking-change webhook would necessarily re-fire for. Without a regular
// sync, the measured delay from createdAt to platformCommissionSeenAt is
// dominated by how long it took a host to remember to click a button, not by
// Smoobu's real latency - confirmed on a real account, where the one
// reservation checked within hours of a sync showed a 4-hour delay while
// ones left unchecked for over a week showed 150-200+ "hours" that were
// mostly just unattended time. Regular runs close that gap.
//
// The account-looping work itself lives in syncAllSmoobuReservations
// (lib/channels/smoobu-provider.ts) - shared with
// scripts/cron/sync-reservations.ts, the Railway-cron-job equivalent of this
// route. Keep this file as the HTTP-triggered path for as long as an
// external pinger is still in use; once fully cut over to Railway's native
// cron jobs this route can be retired.
//
// Fires the sync in the BACKGROUND and responds immediately, rather than
// awaiting the full run before replying. Free cron pingers commonly cap the
// request timeout at 30 seconds with no way to raise it (confirmed against
// cron-job.org's own UI), and syncing every reservation across every mapped
// property routinely takes longer than that. This is safe specifically
// because this app runs as a persistent `next start` Node process on Railway,
// not a serverless function frozen the instant a response is sent - the
// event loop keeps the sync's pending fetches alive after the HTTP response
// goes out. Results aren't visible to the caller this way, so everything is
// logged instead; check Railway's logs for "[cron/sync-reservations]" to see
// how a given run actually went.
//
// Call on a schedule (hourly is enough - commission is not time-critical the
// way messages are), protected by WEBHOOK_SECRET:
//   GET /api/cron/sync-reservations?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("sync-reservations", runSync);
}

async function runSync() {
  const started = Date.now();
  const r = await syncAllSmoobuReservations();

  console.log(
    `[cron/sync-reservations] done in ${Date.now() - started}ms - accounts=${r.accounts} ` +
    `imported=${r.imported} updated=${r.updated} cancelled=${r.cancelled} errors=${r.errors.length}` +
    (r.errors.length ? ` (${r.errors.join("; ")})` : "")
  );

  // Every connected account failing is an outage worth reporting; one account
  // erroring among several is not, and is already logged above.
  if (r.accounts > 0 && r.errors.length >= r.accounts) {
    throw new Error(r.errors.join("; "));
  }
  return { accounts: r.accounts, imported: r.imported, updated: r.updated, cancelled: r.cancelled, errors: r.errors.length };
}
