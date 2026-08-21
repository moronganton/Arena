import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { closeStaleCronRuns } from "@/lib/cron-run";

// One view of whether the scheduled jobs are actually working.
//
// "Last run succeeded" is not the whole story for a job on a schedule: one
// that stops being called at all looks identical to one that is healthy and
// idle, because in both cases the most recent run is a success. So this also
// reports how long ago each job last ran against how often it is expected to,
// and calls it stale when the gap is too wide.
//
//   GET /api/debug/cron-health
// Intervals are deliberately generous rather than matching the pinger
// exactly: combined with STALE_MULTIPLIER below, a job firing late must read
// as late, not as an outage.
const EXPECTED_INTERVAL_MINUTES: Record<string, number> = {
  "channex-messages": 15,
  "channex-revisions": 60,
  "drain-ari": 60,
  "sync-reservations": 60,
  // Records runs since it moved to startCronRun; without an entry here its
  // outcomes are stored but never surfaced anywhere.
  "sync-messages": 15,
};

// Allow a wide margin before calling a job stale - a pinger firing a little
// late must not read as an outage.
const STALE_MULTIPLIER = 3;

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const staleClosed = await closeStaleCronRuns();

  const jobs = await Promise.all(
    Object.entries(EXPECTED_INTERVAL_MINUTES).map(async ([job, everyMinutes]) => {
      const [lastRun, lastFailure, recent] = await Promise.all([
        prisma.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } }),
        prisma.cronRun.findFirst({ where: { job, ok: false }, orderBy: { startedAt: "desc" } }),
        prisma.cronRun.findMany({ where: { job }, orderBy: { startedAt: "desc" }, take: 20, select: { ok: true } }),
      ]);

      const minutesAgo = lastRun ? Math.round((Date.now() - lastRun.startedAt.getTime()) / 60000) : null;
      const failuresInLast20 = recent.filter((r) => r.ok === false).length;

      let status: string;
      if (!lastRun) status = "never run";
      else if (minutesAgo !== null && minutesAgo > everyMinutes * STALE_MULTIPLIER) status = "stale - not being called";
      else if (lastRun.ok === false) status = "failing";
      else if (failuresInLast20 > 0) status = "recovered";
      else status = "healthy";

      return {
        job,
        status,
        expectedEveryMinutes: everyMinutes,
        lastRunAt: lastRun?.startedAt ?? null,
        minutesSinceLastRun: minutesAgo,
        lastRunOk: lastRun?.ok ?? null,
        lastRunSummary: lastRun?.summary ?? null,
        failuresInLast20Runs: failuresInLast20,
        lastFailure: lastFailure
          ? { at: lastFailure.startedAt, error: lastFailure.error }
          : null,
      };
    })
  );

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    staleRunsClosed: staleClosed,
    allHealthy: jobs.every((j) => j.status === "healthy"),
    needsAttention: jobs.filter((j) => j.status !== "healthy").map((j) => `${j.job}: ${j.status}`),
    jobs,
  });
}
