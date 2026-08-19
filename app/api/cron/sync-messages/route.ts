import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { smoobuProvider } from "@/lib/channels/smoobu-provider";

// Continuously pulls new guest messages from Smoobu for all accounts and runs
// each through the AI — so replies happen 24/7 without waiting for the host to
// open a thread or for a reservation webhook to fire.
//
// Call on a schedule (every 2–3 minutes is ideal), protected by WEBHOOK_SECRET:
//   GET /api/cron/sync-messages?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });

  let reservationsChecked = 0;
  let newMessages = 0;
  for (const account of accounts) {
    try {
      const r = await smoobuProvider.syncMessages(account.userId);
      reservationsChecked += r.checked;
      newMessages += r.newMessages;
    } catch (err) {
      console.error(`[cron/sync-messages] account ${account.userId} failed:`, err);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    accounts: accounts.length,
    reservationsChecked,
    newMessages,
    tookMs: Date.now() - started,
  });
}
