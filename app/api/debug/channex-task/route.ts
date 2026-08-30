import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexGet, ChannexError } from "@/lib/channels/channex-core";

// What Channex actually received for a task id, summarised.
//
// Every certification test is graded on a task id, and the question asked of
// each one is the same: did it succeed, how many values did it carry, which
// rate plans and dates did it cover, and was it ONE call rather than several.
// The generic probe truncates a body at ~1.5KB, which for a 500-day full sync
// shows the first two values and nothing that answers any of that.
//
// Read-only, and it triggers nothing. It reports on a push the app already
// made from its own UI - the opposite of the certification harness the
// process rejects, which would be code that makes the calls FOR the UI.
//
//   GET /api/debug/channex-task?id=<task uuid>
interface TaskValue {
  date?: string;
  rate_plan_id?: string;
  room_type_id?: string;
  rate?: number;
  min_stay_arrival?: number;
  stop_sell?: boolean;
  availability?: number;
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let attrs: {
    success?: boolean;
    errors?: unknown[];
    source?: string;
    payload?: { values?: TaskValue[] };
  };
  try {
    const res = await channexGet<{ attributes?: typeof attrs }>(`/tasks/${id}`);
    attrs = res.data?.attributes ?? {};
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, status: e.status }, { status: 502 });
  }

  const values = attrs.payload?.values ?? [];
  const dates = [...new Set(values.map((v) => v.date).filter(Boolean))].sort();
  const byPlan = new Map<string, number>();
  for (const v of values) {
    const k = v.rate_plan_id ?? "(availability - room type only)";
    byPlan.set(k, (byPlan.get(k) ?? 0) + 1);
  }

  // A restrictions push carries a rate; an availability push does not. Saying
  // which endpoint a task came from is the first thing to check when the test
  // expects exactly one of each.
  const kind = values.some((v) => v.rate !== undefined)
    ? "restrictions"
    : values.some((v) => v.availability !== undefined)
      ? "availability"
      : "unknown";

  const rates = values.map((v) => v.rate).filter((r): r is number => r !== undefined);
  const minStays = values.map((v) => v.min_stay_arrival).filter((m): m is number => m !== undefined);

  return NextResponse.json({
    id,
    success: attrs.success,
    errors: attrs.errors ?? [],
    source: attrs.source,
    kind,
    values: values.length,
    days: dates.length,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    ratePlans: Object.fromEntries(byPlan),
    // Certification rejects uniform placeholder data outright, so the spread
    // is worth reporting rather than the first row.
    distinctRates: [...new Set(rates)].sort((a, b) => a - b),
    distinctMinStays: [...new Set(minStays)].sort((a, b) => a - b),
    stopSellDays: values.filter((v) => v.stop_sell === true).length,
    zeroAvailabilityDays: values.filter((v) => v.availability === 0).length,
  });
}
