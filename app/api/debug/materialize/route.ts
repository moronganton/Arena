import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { buildAriValues } from "@/lib/channels/channex-ari";
import { derivedPriceFor } from "@/lib/channels/rate-plan-spec";

// What a date range actually resolves to, and what each rate plan quotes for it.
//
// The pricing rules and the rate plans are two layers that meet exactly once,
// at the number the materializer produces for a night - and there was no way to
// see that number without reading a Channex push. This shows the resolved
// price, minimum stay and availability per date, then what every derived plan
// makes of it.
//
// Read-only, and it calls buildAriValues - the same function drain-ari pushes
// from - so this is the real answer rather than a reimplementation that could
// drift from it.
//
//   GET /api/debug/materialize?from=2026-09-01&to=2026-10-01
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  }
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || !(to > from)) {
    return NextResponse.json({ error: "from must be a valid date before to" }, { status: 400 });
  }

  let propertyId = searchParams.get("propertyId");
  if (!propertyId) {
    const candidates = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX", channexListing: { isNot: null } },
      select: { id: true },
    });
    if (candidates.length !== 1) {
      return NextResponse.json({ error: `pass ?propertyId= (found ${candidates.length})` }, { status: 400 });
    }
    propertyId = candidates[0].id;
  }

  const guard = await requireChannexProperty(propertyId, access.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const [values, plans, property, rules] = await Promise.all([
    buildAriValues(propertyId, from, to),
    prisma.ratePlan.findMany({
      where: { channexListingId: guard.channexListingId },
      orderBy: { position: "asc" },
    }),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { basePrice: true, currency: true } }),
    prisma.pricingRule.findMany({ where: { propertyId, active: true }, orderBy: { priority: "asc" } }),
  ]);

  return NextResponse.json({
    property: guard.propertyName,
    currency: property.currency,
    basePrice: property.basePrice,
    // The rules in play, so a resolved number below can be traced to what made it.
    activeRules: rules.map((r) => ({
      name: r.name,
      priority: r.priority,
      startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: r.endDate?.toISOString().slice(0, 10) ?? null,
      daysOfWeek: r.daysOfWeek,
      price: r.price,
      adjustment: r.adjustment,
      adjType: r.adjType,
      minNights: r.minNights,
    })),
    ratePlans: plans.map((p) => ({
      title: p.title, kind: p.kind, derivedPercent: p.derivedPercent, minStayArrival: p.minStayArrival,
    })),
    days: values.map((v) => ({
      date: v.date,
      // buildAriValues works in minor units because that is what Channex takes.
      parentPrice: v.rate / 100,
      minStay: v.min_stay_arrival,
      available: v.availability === 1 && !v.stop_sell,
      quotes: Object.fromEntries(plans.map((p) => [p.title, derivedPriceFor(v.rate / 100, p.derivedPercent)])),
    })),
  });
}
