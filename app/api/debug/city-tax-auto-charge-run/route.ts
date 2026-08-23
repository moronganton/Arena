import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { runCityTaxAutoCharge } from "@/lib/city-tax-automation";

// Manual trigger + smoke test for the auto-charge cron job, without waiting
// for the hourly cycle. Safe to call anytime: it only ever touches a
// reservation whose property has cityTaxAutoChargeEnabled=true (default
// false everywhere today) with a SAVED card and no PAID/FAILED charge yet.
//
//   GET /api/debug/city-tax-auto-charge-run
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const result = await runCityTaxAutoCharge();
  return NextResponse.json(result);
}
