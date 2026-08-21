import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  materializeRates,
  ruleAppliesOn,
  PricingRuleLike,
  CalendarBlockLike,
} from "@/lib/channels/rate-materializer";

const MANUAL_PREFIX = "[manual]";

// Read-only per-day view of what a Channex property's OWN rule engine
// resolves to - the exact same materializeRates() the ARI push path
// (buildAriValues in channex-ari.ts) uses - so what the calendar shows is
// guaranteed to be what actually gets pushed to Channex, not a separate
// approximation of it.
//
// Each day also carries WHY it is what it is: which rules applied, and who
// is staying. materializeRates collapses "blocked" and "occupied" into a
// single available flag, which is the right answer for Channex but too
// coarse for a person - a maintenance closure and a paying guest are not
// the same thing to look at - so both are reported separately here.
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
  // exclusive upper bound, matching the checkIn/checkOut convention.
  const dateTo = new Date(new Date(end).getTime() + 86400000);

  const [rules, blocks, stays] = await Promise.all([
    prisma.pricingRule.findMany({ where: { propertyId, active: true } }),
    prisma.calendarBlock.findMany({ where: { propertyId } }),
    prisma.reservation.findMany({
      where: { propertyId, status: { not: "CANCELLED" }, checkIn: { lt: dateTo }, checkOut: { gt: dateFrom } },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        source: true,
        totalAmount: true,
        currency: true,
        guest: { select: { name: true } },
      },
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

  interface DayOut {
    price: number;
    minStay: number;
    available: boolean;
    blocked: boolean;
    blockReason: string | null;
    manual: boolean;
    ruleIds: string[];
    stay: { id: string; guestName: string; source: string } | null;
  }

  const rates: Record<string, DayOut> = {};
  for (const day of days) {
    const d = new Date(day.date);
    // Half-open on both, same as materializeRates: a checkout morning and a
    // block's end date are free again.
    const stay = stays.find((s) => d >= s.checkIn && d < s.checkOut);
    const block = blocks.find((b) => d >= b.startDate && d < b.endDate);
    const applicable = rules.filter((r) => ruleAppliesOn(r as PricingRuleLike, d));
    rates[day.date] = {
      price: day.price,
      minStay: day.minStay,
      available: day.available,
      blocked: !!block,
      blockReason: block?.reason ?? null,
      manual: applicable.some((r) => r.name.startsWith(MANUAL_PREFIX)),
      ruleIds: applicable.map((r) => r.id),
      stay: stay ? { id: stay.id, guestName: stay.guest.name, source: stay.source } : null,
    };
  }

  // Metadata for the rules referenced by ruleIds, so the calendar can show
  // what is setting a selected range's price the way an OTA extranet lists
  // the rate plans behind a date.
  const ruleMeta = rules.map((r) => ({
    id: r.id,
    name: r.name,
    ruleType: r.ruleType,
    price: r.price,
    adjustment: r.adjustment,
    adjType: r.adjType,
    minNights: r.minNights,
    priority: r.priority,
    daysOfWeek: r.daysOfWeek,
  }));

  return NextResponse.json({
    rates,
    rules: ruleMeta,
    currency: property.currency,
    basePrice: property.basePrice,
  });
}
