import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { materializeRates, PricingRuleLike, CalendarBlockLike } from "@/lib/channels/rate-materializer";

const MANUAL_PREFIX = "[manual]";

// Read-only per-day view of what a Channex property's OWN rule engine
// resolves to - the exact same materializeRates() the ARI push path
// (buildAriValues in channex-ari.ts) uses - so what the calendar shows is
// guaranteed to be what actually gets pushed to Channex, not a separate
// approximation of it.
//
// GET /api/pricing/materialized?propertyId=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!propertyId || !start || !end) {
    return NextResponse.json({ error: "propertyId, start and end are required" }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session!.user!.id },
    select: { basePrice: true, currency: true, channelProvider: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json({ error: "This property isn't on Channex - its prices aren't set here" }, { status: 400 });
  }

  const dateFrom = new Date(start);
  // `end` is the last day shown (inclusive); materializeRates wants an
  // exclusive upper bound, matching checkIn/checkOut convention.
  const dateTo = new Date(new Date(end).getTime() + 86400000);

  const [rules, blocks, stays] = await Promise.all([
    prisma.pricingRule.findMany({ where: { propertyId, active: true } }),
    prisma.calendarBlock.findMany({ where: { propertyId } }),
    prisma.reservation.findMany({
      where: { propertyId, status: { not: "CANCELLED" }, checkIn: { lt: dateTo }, checkOut: { gt: dateFrom } },
      select: { checkIn: true, checkOut: true },
    }),
  ]);

  const days = materializeRates(
    property.basePrice,
    rules as PricingRuleLike[],
    blocks as CalendarBlockLike[],
    dateFrom,
    dateTo,
    stays
  );

  // Flags which days a manual calendar-edit currently covers, so the UI can
  // show an edited day differently from one still following a season/weekend
  // rule underneath it.
  const manualRules = rules.filter((r) => r.name.startsWith(MANUAL_PREFIX) && r.startDate && r.endDate);
  const rates: Record<string, { price: number; minStay: number; available: boolean; manual: boolean }> = {};
  for (const day of days) {
    const d = new Date(day.date);
    const manual = manualRules.some((r) => d >= r.startDate! && d <= r.endDate!);
    rates[day.date] = { price: day.price, minStay: day.minStay, available: day.available, manual };
  }

  return NextResponse.json({ rates, currency: property.currency, basePrice: property.basePrice });
}
