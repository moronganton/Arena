import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { collectCronHealth, isAlertworthy } from "@/lib/cron-health";
import { notifyUserThrottled } from "@/lib/notify";

// The watchdog that watches the watchers.
//
// Every other cron job reports its own health into CronRun, and
// /api/debug/cron-health reads that back - but only when a human opens it.
// A job that silently stopped being called therefore stayed silently stopped
// until someone thought to check. This runs the same check on a schedule and
// pushes to the phone when something is actually broken.
//
// It cannot detect its own absence, which is the one blind spot: if THIS job
// stops being called, nothing complains. That is what the external uptime
// check covers, and why the two are separate.
//
// Alerts are throttled to one per job per 6 hours. A stale job is still
// stale fifteen minutes later, and an alert that repeats every cycle is an
// alert you learn to dismiss.
//
// Call on a schedule (every 15-30 minutes is plenty), protected by
// WEBHOOK_SECRET:
//   GET /api/cron/health-check?secret=YOUR_WEBHOOK_SECRET
const ALERT_WINDOW_MINUTES = 6 * 60;

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const health = await collectCronHealth();
  const broken = health.jobs.filter((j) => isAlertworthy(j.status));

  // Deliberately not wrapped in startCronRun: this job's purpose is to
  // report on the others, and giving it its own CronRun row would put it in
  // the very list it inspects, alerting about itself.
  if (broken.length === 0) {
    return NextResponse.json({ checkedAt: health.checkedAt, allHealthy: true, alerted: [] });
  }

  // Every account that can act on this - in practice one, but reading it
  // from the database rather than assuming keeps this correct once other
  // people have logins.
  const owners = await prisma.user.findMany({ select: { id: true } });

  const alerted: string[] = [];
  for (const job of broken) {
    const stale = job.status === "stale - not being called";
    const title = stale ? `${job.job} has stopped running` : `${job.job} is failing`;
    const body = stale
      ? `Last ran ${job.minutesSinceLastRun ?? "?"} minutes ago; expected every ${job.expectedEveryMinutes}. Bookings and availability may not be syncing.`
      : `Its last run failed: ${job.lastFailure?.error?.slice(0, 140) ?? "no error recorded"}`;

    for (const owner of owners) {
      const sent = await notifyUserThrottled(
        owner.id,
        { type: "cron_stale", title, body, link: "/settings/channels" },
        ALERT_WINDOW_MINUTES
      );
      if (sent && !alerted.includes(job.job)) alerted.push(job.job);
    }
  }

  console.error(`[cron/health-check] needs attention: ${health.needsAttention.join(", ")}`);
  return NextResponse.json({
    checkedAt: health.checkedAt,
    allHealthy: false,
    needsAttention: health.needsAttention,
    alerted,
    suppressed: broken.filter((j) => !alerted.includes(j.job)).map((j) => j.job),
  });
}
