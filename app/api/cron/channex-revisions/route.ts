import { NextRequest, NextResponse } from "next/server";
import { pollChannexRevisions } from "@/lib/channels/channex-revisions";

// Runs pollChannexRevisions on a schedule - the belt-and-braces backstop
// Channex's certification requires alongside webhooks (see
// lib/channels/channex-revisions.ts for why).
//
// Fires in the background and responds immediately, same reasoning as
// cron/sync-reservations: this runs as a persistent `next start` process on
// Railway, not a serverless function torn down the instant a response goes
// out, so the pending work keeps running after the HTTP response is sent.
// Results aren't visible to the caller this way - check Railway's logs for
// "[channex-revisions]", or use /api/debug/channex-revisions-run for a
// synchronous run with the result in the response.
//
// Call on a schedule (hourly is enough), protected by WEBHOOK_SECRET:
//   GET /api/cron/channex-revisions?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  pollChannexRevisions()
    .then((r) =>
      console.log(
        `[channex-revisions] done - candidates=${r.candidates} processed=${r.processed} ` +
          `reservationsTouched=${r.reservationsTouched} errors=${r.errors.length}` +
          (r.errors.length ? ` (${r.errors.join("; ")})` : "")
      )
    )
    .catch((err) => console.error("[channex-revisions] background run failed:", err));

  return NextResponse.json({ started: true, startedAt: new Date().toISOString() });
}
