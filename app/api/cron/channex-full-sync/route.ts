import { NextRequest, NextResponse } from "next/server";
import { runFullSyncForAllChannexProperties } from "@/lib/channels/channex-ari";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

// Runs a full 500-day ARI sync for every Channex-provisioned property, once
// a day. Closes the gap routine pushes leave: a basePrice edit or an
// open-ended PricingRule only pushes 365 days out (see
// lib/channels/ari-outbox.ts), so without this, the far 366-500 days of
// what an OTA can show a guest booking ahead would only ever refresh when
// someone manually clicks "Force full resync" - drifting stale indefinitely
// for a property nobody happens to touch.
//
// Channex explicitly allows this: "Full sync is allowed once every 24h if
// required but please schedule this on off peak hours" (certification test
// 13). Schedule accordingly - once daily, off-peak, not more often.
//
// Fires in the background and responds immediately, same reasoning as the
// other cron routes here: this runs as a persistent `next start` process on
// Railway, not a serverless function torn down the instant a response goes
// out. Results aren't visible to the caller this way - check Railway's logs
// for "[channex-ari] full sync", or use /api/debug/channex-full-sync for a
// synchronous single-property run with the result in the response.
//
// Call once daily, off-peak, protected by WEBHOOK_SECRET:
//   GET /api/cron/channex-full-sync?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("channex-full-sync", async () => {
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
}
