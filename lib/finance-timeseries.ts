import { prisma } from "@/lib/prisma";

export interface MonthSummary {
  month: string; // YYYY-MM
  grossRevenue: number;
  totalCosts: number;
  netIncome: number;
  reservations: number;
}

// Same aggregation rules as /api/finance/report (revenue recognized at checkout,
// costs = expenses + recurring + per-reservation + auto platform fees), collapsed
// to just the totals a time-series chart needs. A propertyId scopes everything to
// that property alone — general (portfolio-wide) costs are excluded, matching how
// the single-month report already treats a property filter.
export async function computeMonthSummary(
  ownerId: string,
  month: string,
  propertyId?: string
): Promise<MonthSummary> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { ownerId },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: start, lt: end },
      ...(propertyId ? { propertyId } : {}),
    },
    select: { totalAmount: true, source: true, propertyId: true },
  });

  const revenueBySource: Record<string, number> = {};
  const reservationCountByProperty = new Map<string, number>();
  let grossRevenue = 0;
  for (const r of reservations) {
    const amount = r.totalAmount || 0;
    grossRevenue += amount;
    revenueBySource[r.source] = (revenueBySource[r.source] || 0) + amount;
    reservationCountByProperty.set(r.propertyId, (reservationCountByProperty.get(r.propertyId) || 0) + 1);
  }

  const expenses = await prisma.expense.findMany({
    where: {
      ownerId,
      date: { gte: start, lt: end },
      ...(propertyId ? { propertyId } : {}),
    },
    select: { amount: true },
  });
  let totalCosts = expenses.reduce((s, e) => s + e.amount, 0);

  const recurring = await prisma.recurringExpense.findMany({
    where: {
      ownerId,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      ...(propertyId ? { propertyId } : {}),
    },
    select: { amount: true },
  });
  totalCosts += recurring.reduce((s, r) => s + r.amount, 0);

  const perReservation = await prisma.perReservationCost.findMany({
    where: {
      ownerId,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      ...(propertyId ? { propertyId } : {}),
    },
    select: { amount: true, propertyId: true },
  });
  const totalReservationCount = Array.from(reservationCountByProperty.values()).reduce((s, c) => s + c, 0);
  for (const pr of perReservation) {
    const count = pr.propertyId ? reservationCountByProperty.get(pr.propertyId) || 0 : totalReservationCount;
    totalCosts += Math.round(pr.amount * count * 100) / 100;
  }

  const feeSettings = await prisma.platformFeeSetting.findMany({ where: { ownerId } });
  for (const f of feeSettings) {
    const base = revenueBySource[f.channel] || 0;
    if (base > 0 && f.percent > 0) totalCosts += Math.round(base * f.percent) / 100;
  }

  return {
    month,
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    totalCosts: Math.round(totalCosts * 100) / 100,
    netIncome: Math.round((grossRevenue - totalCosts) * 100) / 100,
    reservations: reservations.length,
  };
}

// Inclusive list of "YYYY-MM" strings from `from` through `to`.
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}
