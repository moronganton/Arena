import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET ?month=YYYY-MM — gross revenue vs costs vs net income, per property
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  // Revenue: reservations checking out within the month (revenue recognized at checkout)
  const reservations = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: start, lt: end },
    },
    select: {
      totalAmount: true,
      currency: true,
      source: true,
      propertyId: true,
      property: { select: { id: true, name: true, city: true, currency: true } },
    },
  });

  const expenses = await prisma.expense.findMany({
    where: {
      ownerId: session.user.id,
      date: { gte: start, lt: end },
    },
    select: {
      amount: true,
      currency: true,
      category: true,
      propertyId: true,
      description: true,
    },
  });

  // Recurring monthly costs active in this month
  const recurring = await prisma.recurringExpense.findMany({
    where: {
      ownerId: session.user.id,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    },
    include: { property: { select: { id: true, name: true } } },
  });

  // Platform fee settings (% per channel)
  const feeSettings = await prisma.platformFeeSetting.findMany({
    where: { ownerId: session.user.id },
  });
  const feePercentByChannel = new Map(feeSettings.map((f) => [f.channel, f.percent]));

  // Aggregate per property (amounts kept in native currency per property)
  const propertyMap = new Map<
    string,
    {
      id: string;
      name: string;
      city: string;
      currency: string;
      revenue: number;
      reservationCount: number;
      revenueBySource: Record<string, number>;
      costs: number;
      costsByCategory: Record<string, number>;
    }
  >();

  for (const r of reservations) {
    const p = r.property;
    if (!propertyMap.has(p.id)) {
      propertyMap.set(p.id, {
        id: p.id, name: p.name, city: p.city, currency: p.currency,
        revenue: 0, reservationCount: 0, revenueBySource: {}, costs: 0, costsByCategory: {},
      });
    }
    const entry = propertyMap.get(p.id)!;
    const amount = r.totalAmount || 0;
    entry.revenue += amount;
    entry.reservationCount++;
    entry.revenueBySource[r.source] = (entry.revenueBySource[r.source] || 0) + amount;
  }

  const generalCosts: Record<string, number> = {};
  let generalCostTotal = 0;

  for (const e of expenses) {
    if (e.propertyId && propertyMap.has(e.propertyId)) {
      const entry = propertyMap.get(e.propertyId)!;
      entry.costs += e.amount;
      entry.costsByCategory[e.category] = (entry.costsByCategory[e.category] || 0) + e.amount;
    } else if (e.propertyId) {
      // Property with expenses but no revenue this month — still include it
      const prop = await prisma.property.findUnique({
        where: { id: e.propertyId },
        select: { id: true, name: true, city: true, currency: true },
      });
      if (prop) {
        propertyMap.set(prop.id, {
          id: prop.id, name: prop.name, city: prop.city, currency: prop.currency,
          revenue: 0, reservationCount: 0, revenueBySource: {},
          costs: e.amount, costsByCategory: { [e.category]: e.amount },
        });
      }
    } else {
      generalCosts[e.category] = (generalCosts[e.category] || 0) + e.amount;
      generalCostTotal += e.amount;
    }
  }

  // Apply recurring monthly costs
  for (const r of recurring) {
    if (r.propertyId && propertyMap.has(r.propertyId)) {
      const entry = propertyMap.get(r.propertyId)!;
      entry.costs += r.amount;
      entry.costsByCategory[r.category] = (entry.costsByCategory[r.category] || 0) + r.amount;
    } else if (r.propertyId) {
      const prop = await prisma.property.findUnique({
        where: { id: r.propertyId },
        select: { id: true, name: true, city: true, currency: true },
      });
      if (prop) {
        propertyMap.set(prop.id, {
          id: prop.id, name: prop.name, city: prop.city, currency: prop.currency,
          revenue: 0, reservationCount: 0, revenueBySource: {},
          costs: r.amount, costsByCategory: { [r.category]: r.amount },
        });
      }
    } else {
      generalCosts[r.category] = (generalCosts[r.category] || 0) + r.amount;
      generalCostTotal += r.amount;
    }
  }

  // Auto-compute platform fees (% of channel revenue per property)
  const platformFees: Array<{ channel: string; percent: number; base: number; fee: number }> = [];
  const feeTotalsByChannel: Record<string, { base: number; fee: number; percent: number }> = {};
  for (const entry of propertyMap.values()) {
    for (const [src, revenue] of Object.entries(entry.revenueBySource)) {
      const percent = feePercentByChannel.get(src);
      if (!percent || percent <= 0) continue;
      const fee = Math.round(revenue * percent) / 100;
      entry.costs += fee;
      entry.costsByCategory["PLATFORM_FEES"] = (entry.costsByCategory["PLATFORM_FEES"] || 0) + fee;
      if (!feeTotalsByChannel[src]) feeTotalsByChannel[src] = { base: 0, fee: 0, percent };
      feeTotalsByChannel[src].base += revenue;
      feeTotalsByChannel[src].fee += fee;
    }
  }
  for (const [channel, v] of Object.entries(feeTotalsByChannel)) {
    platformFees.push({ channel, percent: v.percent, base: Math.round(v.base * 100) / 100, fee: Math.round(v.fee * 100) / 100 });
  }

  const properties = Array.from(propertyMap.values()).map((p) => ({
    ...p,
    net: p.revenue - p.costs,
    margin: p.revenue > 0 ? Math.round(((p.revenue - p.costs) / p.revenue) * 100) : null,
  }));

  // Overall totals (note: mixes currencies if properties differ — reported per property too)
  const totalRevenue = properties.reduce((s, p) => s + p.revenue, 0);
  const totalCosts = properties.reduce((s, p) => s + p.costs, 0) + generalCostTotal;

  const costsByCategory: Record<string, number> = { ...generalCosts };
  for (const p of properties) {
    for (const [cat, amt] of Object.entries(p.costsByCategory)) {
      costsByCategory[cat] = (costsByCategory[cat] || 0) + amt;
    }
  }

  const revenueBySource: Record<string, number> = {};
  for (const p of properties) {
    for (const [src, amt] of Object.entries(p.revenueBySource)) {
      revenueBySource[src] = (revenueBySource[src] || 0) + amt;
    }
  }

  return NextResponse.json({
    month,
    summary: {
      grossRevenue: Math.round(totalRevenue * 100) / 100,
      totalCosts: Math.round(totalCosts * 100) / 100,
      netIncome: Math.round((totalRevenue - totalCosts) * 100) / 100,
      margin: totalRevenue > 0 ? Math.round(((totalRevenue - totalCosts) / totalRevenue) * 100) : null,
      reservations: reservations.length,
    },
    revenueBySource,
    costsByCategory,
    generalCosts: { total: generalCostTotal, byCategory: generalCosts },
    platformFees,
    recurringCosts: recurring.map((r) => ({
      id: r.id,
      category: r.category,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      property: r.property,
    })),
    properties: properties.sort((a, b) => b.net - a.net),
  });
}
