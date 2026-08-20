import { NextRequest, NextResponse } from "next/server";
import { pollChannexMessages } from "@/lib/channels/channex-messages";

// Collects new guest messages from Channex on a schedule.
//
// This is not a safety net, it is the only inbound route. A webhook for
// message events is registered and active with send_data set, and has never
// delivered anything - across two different test hotels, including while a
// thread was live and being written to. Booking events on the very same
// callback URL arrive reliably, so the receiver is fine. Until that is
// explained, nothing collects guest messages unless this runs.
//
// Fires in the background and responds immediately, same reasoning as the
// other cron routes here: this runs as a persistent `next start` process on
// Railway rather than a serverless function that is frozen once a response is
// sent, so the pending work survives. Results are logged rather than
// returned - check Railway for "[channex-messages]", or use
// /api/debug/channex-messages-run for a synchronous run.
//
// Hourly is too slow for a guest waiting on an answer; every 5-10 minutes is
// more appropriate for messaging. Protected by WEBHOOK_SECRET:
//   GET /api/cron/channex-messages?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  pollChannexMessages()
    .then((r) =>
      console.log(
        `[channex-messages] done - checked=${r.reservationsChecked} imported=${r.imported} ` +
          `unsupported=${r.unsupported} errors=${r.errors.length}` +
          (r.errors.length ? ` (${r.errors.join("; ")})` : "")
      )
    )
    .catch((err) => console.error("[channex-messages] background run failed:", err));

  return NextResponse.json({ started: true, startedAt: new Date().toISOString() });
}
