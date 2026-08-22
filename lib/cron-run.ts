import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Runs a scheduled job in the background and makes its failures visible to
// whatever is calling the cron URL.
//
// The problem this solves: these routes hand their work to the background and
// answer immediately, because free cron pingers cap the request timeout well
// below a full run. The 200 the pinger receives therefore means only "the
// request arrived" - a job can fail on every single tick while the pinger's
// dashboard stays green, and the failure lives only in server logs nobody is
// watching.
//
// A run cannot report on itself here, but it can report on the one before it.
// So the response carries the PREVIOUS run's outcome: 200 when that succeeded,
// 500 when it failed. The pinger's own "notify me when execution fails" then
// works again, one cycle late - which for a fifteen-minute schedule means a
// broken job is surfaced within half an hour instead of never.
//
// A run still in flight is not treated as failure: a slow job would otherwise
// alert purely for being slow. Runs left dangling by a process restart are
// aged out so they cannot mask a later failure forever.
const STALE_RUN_MS = 30 * 60 * 1000;

export interface CronOutcome {
  ok: boolean;
  summary?: Record<string, unknown>;
  error?: string;
}

export async function startCronRun(
  job: string,
  work: () => Promise<Record<string, unknown> | void>
): Promise<NextResponse> {
  const previous = await prisma.cronRun.findFirst({
    where: { job, ok: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { ok: true, error: true, summary: true, finishedAt: true },
  });

  const run = await prisma.cronRun.create({ data: { job } });

  // Deliberately not awaited - see the note above about pinger timeouts.
  work()
    .then(async (summary) => {
      const text = summary ? JSON.stringify(summary) : null;
      console.log(`[cron/${job}] done${text ? ` - ${text}` : ""}`);
      await prisma.cronRun.update({
        where: { id: run.id },
        data: { ok: true, finishedAt: new Date(), summary: text?.slice(0, 2000), error: null },
      });
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/${job}] failed:`, err);
      await prisma.cronRun
        .update({
          where: { id: run.id },
          data: { ok: false, finishedAt: new Date(), error: message.slice(0, 1000) },
        })
        .catch(() => {});
    });

  if (previous && previous.ok === false) {
    return NextResponse.json(
      {
        started: true,
        startedAt: run.startedAt.toISOString(),
        previousRun: {
          ok: false,
          finishedAt: previous.finishedAt,
          error: previous.error,
        },
        note: "This run started normally. The non-2xx reports the PREVIOUS run, which failed - see error above.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    started: true,
    startedAt: run.startedAt.toISOString(),
    previousRun: previous ? { ok: previous.ok, finishedAt: previous.finishedAt, summary: previous.summary } : null,
  });
}

// The standalone-script counterpart to startCronRun, for jobs that run as
// their own process (a Railway Cron Job) rather than as a background promise
// on the persistent web server. There is no HTTP response to smuggle the
// previous run's outcome through here - the whole reason that trick exists
// is a pinger's 30s request timeout, and a cron job's own process has no
// such limit; it is awaited to completion by whatever scheduled it, and its
// exit code IS the success/failure signal. So this awaits `work` directly
// and rethrows on failure, for the caller to turn into `process.exitCode = 1`.
//
// Still writes the same CronRun rows as startCronRun, under the same `job`
// name, so /api/debug/cron-health keeps working unchanged regardless of
// which of the two ever actually calls a given job.
export async function runCronJobToCompletion(
  job: string,
  work: () => Promise<Record<string, unknown> | void>
): Promise<Record<string, unknown> | void> {
  const run = await prisma.cronRun.create({ data: { job } });
  try {
    const summary = await work();
    const text = summary ? JSON.stringify(summary) : null;
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { ok: true, finishedAt: new Date(), summary: text?.slice(0, 2000), error: null },
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.cronRun
      .update({ where: { id: run.id }, data: { ok: false, finishedAt: new Date(), error: message.slice(0, 1000) } })
      .catch(() => {});
    throw err;
  }
}

// Anything still marked running well past any plausible runtime was almost
// certainly killed mid-flight by a deploy or restart. Closing those out keeps
// them from sitting in the table forever looking like work in progress.
export async function closeStaleCronRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const { count } = await prisma.cronRun.updateMany({
    where: { ok: null, startedAt: { lt: cutoff } },
    data: { ok: false, finishedAt: new Date(), error: "Run never completed - process restarted or deploy interrupted it" },
  });
  return count;
}
