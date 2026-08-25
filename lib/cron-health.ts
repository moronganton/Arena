import { prisma } from "@/lib/prisma";
import { closeStaleCronRuns } from "@/lib/cron-run";

// Whether the scheduled jobs are actually working.
//
// Lifted out of /api/debug/cron-health so the same judgement can run on a
// schedule instead of only when someone remembers to open the route. A
// health check nobody visits is not monitoring; it is a report that happens
// to exist.
//
// "Last run succeeded" is not the whole story for a job on a schedule: one
// that stops being called at all looks identical to one that is healthy and
// idle, because in both cases the most recent run is a success. So this also
// reports how long ago each job last ran against how often it is expected
// to, and calls it stale when the gap is too wide.

// Intervals are deliberately generous rather than matching the pinger
// exactly: combined with STALE_MULTIPLIER, a job firing late must read as
// late, not as an outage.
export const EXPECTED_INTERVAL_MINUTES: Record<string, number> = {
  "channex-messages": 15,
  "channex-revisions": 60,
  "drain-ari": 60,
  "sync-reservations": 60,
  "sync-messages": 15,
  "channex-full-sync": 1440,
  "scheduled-messages": 60,
};

// Allow a wide margin before calling a job stale - a pinger firing a little
// late must not read as an outage.
export const STALE_MULTIPLIER = 3;

export type JobStatus = "never run" | "stale - not being called" | "failing" | "recovered" | "healthy";

export interface JobHealth {
  job: string;
  status: JobStatus;
  expectedEveryMinutes: number;
  lastRunAt: Date | null;
  minutesSinceLastRun: number | null;
  lastRunOk: boolean | null;
  lastRunSummary: unknown;
  failuresInLast20Runs: number;
  lastFailure: { at: Date; error: string | null } | null;
}

export interface CronHealth {
  checkedAt: string;
  staleRunsClosed: number;
  allHealthy: boolean;
  needsAttention: string[];
  jobs: JobHealth[];
}

export async function collectCronHealth(): Promise<CronHealth> {
  const staleClosed = await closeStaleCronRuns();

  const jobs = await Promise.all(
    Object.entries(EXPECTED_INTERVAL_MINUTES).map(async ([job, everyMinutes]): Promise<JobHealth> => {
      const [lastRun, lastFailure, recent] = await Promise.all([
        prisma.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } }),
        prisma.cronRun.findFirst({ where: { job, ok: false }, orderBy: { startedAt: "desc" } }),
        prisma.cronRun.findMany({ where: { job }, orderBy: { startedAt: "desc" }, take: 20, select: { ok: true } }),
      ]);

      const minutesAgo = lastRun ? Math.round((Date.now() - lastRun.startedAt.getTime()) / 60000) : null;
      const failuresInLast20 = recent.filter((r) => r.ok === false).length;

      let status: JobStatus;
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
        lastFailure: lastFailure ? { at: lastFailure.startedAt, error: lastFailure.error } : null,
      };
    })
  );

  return {
    checkedAt: new Date().toISOString(),
    staleRunsClosed: staleClosed,
    allHealthy: jobs.every((j) => j.status === "healthy"),
    needsAttention: jobs.filter((j) => j.status !== "healthy").map((j) => `${j.job}: ${j.status}`),
    jobs,
  };
}

// "recovered" means it failed at some point in the last 20 runs and is fine
// now - worth seeing on the page, not worth a push notification. These two
// are the states that mean something is broken right now.
export function isAlertworthy(status: JobStatus): boolean {
  return status === "stale - not being called" || status === "failing";
}
