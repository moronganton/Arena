import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { collectCronHealth } from "@/lib/cron-health";

// One view of whether the scheduled jobs are actually working.
//
// The judgement itself now lives in lib/cron-health.ts, shared with
// /api/cron/health-check - so the page you look at and the alert that wakes
// you can never disagree about what "stale" means.
//
//   GET /api/debug/cron-health
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  return NextResponse.json(await collectCronHealth());
}
