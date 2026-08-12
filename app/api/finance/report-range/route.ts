import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { computeMonthSummary, monthsBetween } from "@/lib/finance-timeseries";

// GET ?from=YYYY-MM&to=YYYY-MM&propertyId= — monthly revenue/costs/net time series,
// for the Finance tab's seasonality chart.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const propertyIdParam = searchParams.get("propertyId");
  const propertyIds = propertyIdParam ? propertyIdParam.split(",").filter(Boolean) : undefined;

  if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM) are required" }, { status: 400 });
  }

  const months = monthsBetween(from, to);
  if (months.length === 0 || months.length > 36) {
    return NextResponse.json({ error: "Invalid or too large a date range (max 36 months)" }, { status: 400 });
  }

  const results = await Promise.all(
    months.map((m) => computeMonthSummary(session.user.id, m, propertyIds))
  );

  const totals = results.reduce(
    (acc, r) => ({
      grossRevenue: acc.grossRevenue + r.grossRevenue,
      totalCosts: acc.totalCosts + r.totalCosts,
      netIncome: acc.netIncome + r.netIncome,
    }),
    { grossRevenue: 0, totalCosts: 0, netIncome: 0 }
  );

  return NextResponse.json({
    from,
    to,
    propertyIds: propertyIds || null,
    months: results,
    totals: {
      grossRevenue: Math.round(totals.grossRevenue * 100) / 100,
      totalCosts: Math.round(totals.totalCosts * 100) / 100,
      netIncome: Math.round(totals.netIncome * 100) / 100,
    },
  });
}
