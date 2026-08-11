import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSmoobuBookings } from "@/lib/channels/smoobu";

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
// Call on a schedule (hourly is enough - commission is not time-critical the
// way messages are), protected by WEBHOOK_SECRET:
//   GET /api/cron/sync-reservations?secret=YOUR_WEBHOOK_SECRET
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const r = await syncSmoobuBookings(account.userId);
      imported += r.imported;
      updated += r.updated;
      cancelled += r.cancelled;
      if (r.errors.length) errors.push(...r.errors.map((e) => `${account.userId}: ${e}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/sync-reservations] account ${account.userId} failed:`, err);
      errors.push(`${account.userId}: ${msg}`);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    accounts: accounts.length,
    imported,
    updated,
    cancelled,
    errors,
    tookMs: Date.now() - started,
  });
}
