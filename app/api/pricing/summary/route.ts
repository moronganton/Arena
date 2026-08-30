import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { buildAriValues, pricedValues } from "@/lib/channels/channex-ari";
import { channexGet } from "@/lib/channels/channex-core";
import { connectedChannels, type ChannelConnectionLike } from "@/lib/channels/channel-offers";

// The left half of the Rate plans tab: which rules are in play and what the
// next seven nights resolve to.
//
// This exists so the operator can see cause and effect on one screen - the
// rules ARE the price, but until now the only place that link was visible was
// a debug endpoint. Same discipline as that endpoint: the week is computed by
// buildAriValues, the function drain-ari actually pushes from, so the numbers
// shown here are the numbers Channex receives, not a reimplementation that
// could drift.
//
//   GET /api/pricing/summary?propertyId=...
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Seven nights starting today, UTC-floored the same way the materializer
  // keys its dates.
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [values, property, rules, plans, channels] = await Promise.all([
    buildAriValues(propertyId, from, to),
    prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { basePrice: true, currency: true },
    }),
    prisma.pricingRule.findMany({
      where: { propertyId, active: true },
      orderBy: { priority: "asc" },
    }),
    prisma.ratePlan.findMany({
      where: { channexListingId: guard.channexListingId, active: true },
      orderBy: { position: "asc" },
      select: {
        id: true, title: true, kind: true, derivedPercent: true, derivedAmount: true,
        minStayArrival: true, mealType: true,
      },
    }),
    // Which OTAs actually sell this property. Channex reports connections
    // account-wide with the property ids each covers, so this is the only way
    // to answer it per property. Best-effort on purpose: a failure here must
    // not take down the pricing summary, and the panel says "couldn't check"
    // rather than claiming a channel is absent.
    channexGet<ChannelConnectionLike[]>("/channels")
      .then((res) => connectedChannels(Array.isArray(res.data) ? res.data : [], guard.channexPropertyId))
      .catch(() => null),
  ]);

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return NextResponse.json({
    currency: property.currency,
    basePrice: property.basePrice,
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: r.endDate?.toISOString().slice(0, 10) ?? null,
      daysOfWeek: r.daysOfWeek,
      price: r.price,
      adjustment: r.adjustment,
      adjType: r.adjType,
      minNights: r.minNights,
      priority: r.priority,
    })),
    plans,
    // null means "not determined", which the UI must render differently from
    // an empty list - one is ignorance, the other is a fact.
    connectedChannels: channels,
    // One row per date. buildAriValues emits one per date per rate plan, so
    // mapping it straight through would repeat every night once per plan.
    week: pricedValues(values).map((v) => ({
      date: v.date,
      dow: DOW[new Date(`${v.date}T00:00:00.000Z`).getUTCDay()],
      // buildAriValues works in minor units because that is what Channex takes.
      price: v.rate / 100,
      minStay: v.min_stay_arrival,
    })),
  });
}
