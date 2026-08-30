import { NextRequest, NextResponse } from "next/server";
import { reconcileUnlandedBookings } from "@/lib/channels/booking-reconcile";
import { startCronRun, closeStaleCronRuns } from "@/lib/cron-run";

// Picks up bookings that arrived before Channex had finished resolving them.
//
// The webhook path retries for ~17s when a booking's room/rate ids come back
// null, which covers the usual case. When resolution takes longer, the
// delivery is skipped and the revision is acknowledged anyway - so Channex
// will never re-send it, and the stay is silently lost with its nights still
// on sale. This closes that window.
//
// Cheap when there is nothing to do: one indexed query over a 48-hour slice
// of the webhook log, and no Channex call at all unless a candidate is found.
//
// Call every 15 minutes, protected by WEBHOOK_SECRET:
//   GET /api/cron/channex-reconcile-bookings?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await closeStaleCronRuns();
  return startCronRun("channex-reconcile-bookings", async () => {
    const r = await reconcileUnlandedBookings();
    return {
      examined: r.examined,
      retried: r.retried,
      recovered: r.recovered.length,
      stillUnresolved: r.stillUnresolved.length,
    };
  });
}
