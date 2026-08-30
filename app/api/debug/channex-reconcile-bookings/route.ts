import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { reconcileUnlandedBookings } from "@/lib/channels/booking-reconcile";

// The same sweep the cron runs, synchronously and with the full result in the
// response - the cron fires in the background and reports only counts.
//
//   GET /api/debug/channex-reconcile-bookings[&windowHours=48][&cap=25]
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const params = new URL(req.url).searchParams;
  const windowHours = Number(params.get("windowHours")) || undefined;
  const cap = Number(params.get("cap")) || undefined;

  return NextResponse.json(await reconcileUnlandedBookings({ windowHours, cap }));
}
