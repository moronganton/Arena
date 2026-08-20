import { NextRequest, NextResponse } from "next/server";
import { pollChannexMessages } from "@/lib/channels/channex-messages";

// Scheduled backstop for inbound Channex guest messages - see
// pollChannexMessages in lib/channels/channex-messages.ts for why webhooks
// alone are not enough here.
//
// Should run more often than the revisions poller: a booking arriving a few
// minutes late is harmless, but Booking.com scores properties on guest
// response time, so a message sitting unimported is a real cost. Every 5-10
// minutes is reasonable; the poller paces its own calls to stay inside the
// account-wide rate limit either way.
//
// Fires in the background and responds immediately, same reasoning as
// cron/sync-reservations and cron/channex-revisions: this runs as a
// persistent `next start` process on Railway, so pending work survives the
// response. Check Railway's logs for "[channex-messages]", or use
// /api/debug/channex-messages-run for a synchronous run with the result in
// the response.
//
//   GET /api/cron/channex-messages?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  pollChannexMessages()
    .then((r) =>
      console.log(
        `[channex-messages] poll done - reservationsChecked=${r.reservationsChecked} imported=${r.imported} ` +
          `unsupported=${r.unsupported} errors=${r.errors.length}` +
          (r.errors.length ? ` (${r.errors.join("; ")})` : "")
      )
    )
    .catch((err) => console.error("[channex-messages] background poll failed:", err));

  return NextResponse.json({ started: true, startedAt: new Date().toISOString() });
}
