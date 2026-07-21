import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSmoobuRatesMulti } from "@/lib/channels/smoobu-core";

const CUR: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", RON: "lei", CHF: "CHF" };

// GET /api/pricing/live-batch?start=YYYY-MM-DD&end=YYYY-MM-DD
// Live Smoobu prices for ALL of the host's Smoobu-mapped properties over a date
// range, in one call — used to overlay rates on the calendar. Read-only.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end required" }, { status: 400 });

  const mappings = await prisma.channelConfig.findMany({
    where: { channel: "SMOOBU", listingId: { not: null }, property: { ownerId: session.user.id } },
    select: { listingId: true, propertyId: true, property: { select: { currency: true } } },
  });
  if (mappings.length === 0) return NextResponse.json({ prices: {}, currency: {} });

  const apartmentIds = mappings.map((m) => m.listingId!) as string[];
  const aptToProperty = new Map(mappings.map((m) => [m.listingId!, m.propertyId]));
  const currency: Record<string, string> = {};
  for (const m of mappings) currency[m.propertyId] = CUR[m.property.currency] || m.property.currency + " ";

  try {
    const byApt = await getSmoobuRatesMulti(session.user.id, apartmentIds, start, end);
    // Re-key by propertyId, keeping only the price per date (calendar only needs that)
    const prices: Record<string, Record<string, number>> = {};
    for (const [aptId, days] of Object.entries(byApt)) {
      const propId = aptToProperty.get(aptId) || aptToProperty.get(String(Number(aptId)));
      if (!propId) continue;
      const perDay: Record<string, number> = {};
      for (const [date, r] of Object.entries(days)) if (r.price != null) perDay[date] = r.price;
      prices[propId] = perDay;
    }
    return NextResponse.json({ prices, currency });
  } catch (err) {
    return NextResponse.json({ prices: {}, currency, error: err instanceof Error ? err.message : "Failed to read rates" }, { status: 502 });
  }
}
