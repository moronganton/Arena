import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSmoobuMessagesForReservation } from "@/lib/channels/smoobu-core";
import { processIncomingMessage } from "@/lib/ai";

// Continuously pulls new guest messages from Smoobu for all recent reservations
// and runs each through the AI — so replies happen 24/7 without waiting for the
// host to open a thread or for a reservation webhook to fire.
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
  const cutoff = new Date(Date.now() - 7 * 86400000); // stays that ended in the last week + upcoming

  let reservationsChecked = 0;
  let newMessages = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    let reservations;
    try {
      reservations = await prisma.reservation.findMany({
        where: {
          property: { ownerId: account.userId },
          externalId: { startsWith: "smoobu-" },
          status: { not: "CANCELLED" },
          checkOut: { gte: cutoff },
        },
        select: { id: true, externalId: true },
        orderBy: { checkIn: "asc" },
        take: 60,
      });
    } catch (err) {
      errors.push(`load ${account.userId}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const r of reservations) {
      reservationsChecked++;
      try {
        const newIds = await syncSmoobuMessagesForReservation(account.userId, r);
        for (const id of newIds) {
          await processIncomingMessage(id); // AI reply + notifications + delivery
          newMessages++;
        }
      } catch (err) {
        console.error(`[cron/sync-messages] ${r.externalId} failed:`, err);
      }
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    accounts: accounts.length,
    reservationsChecked,
    newMessages,
    tookMs: Date.now() - started,
    errors: errors.slice(0, 5),
  });
}
