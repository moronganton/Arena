import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSmoobuBookings } from "@/lib/channels/smoobu";

// Smoobu webhook: fired on new/updated/cancelled reservations.
// Treated as a "something changed" signal — we run a full incremental sync.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });
  const results = [];
  for (const account of accounts) {
    try {
      const r = await syncSmoobuBookings(account.userId);
      console.log(`[smoobu-webhook] sync for user ${account.userId}:`, JSON.stringify(r));
      results.push(r);
    } catch (err) {
      console.error("[smoobu-webhook] sync failed:", err);
      results.push({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
