import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncBeds24Bookings } from "@/lib/channels/beds24";

// Beds24 booking webhook: fired on new/modified/cancelled bookings.
// Rather than parsing the (configurable) payload, we treat it as a
// "something changed" signal and run a full incremental sync.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.beds24Account.findMany({ select: { userId: true } });
  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncBeds24Bookings(account.userId));
    } catch (err) {
      console.error("Beds24 webhook sync failed:", err);
      results.push({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ success: true, results });
}

// Beds24 can also be configured to send GET pings
export async function GET(req: NextRequest) {
  return POST(req);
}
