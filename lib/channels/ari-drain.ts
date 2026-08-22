import { prisma } from "@/lib/prisma";
import { pushAriForDateRange } from "./channex-ari";
import { ChannexError } from "./channex-core";

// Turns queued AriOutbox rows into a small number of batched Channex calls.
//
// Coalescing: multiple rows for the same property - a burst of edits, or
// several kinds enqueued for the same change - merge into the smallest set
// of non-overlapping date ranges before anything is sent, so 30 rapid edits
// to overlapping dates cost a handful of calls, not 30.
//
// Rate limiting: Channex's published limit (docs.channex.io/api-v.1-
// documentation/rate-limits) is 20 ARI calls/minute PER PROPERTY, split
// 10 for restrictions/price and 10 for availability - not account-wide, as
// an earlier version of this comment assumed before that page was actually
// read. Calls are still spaced at a fixed interval across the WHOLE run
// rather than per property, which is stricter than required: two properties
// queued together share one combined budget instead of getting 20 each.
// Safe in the conservative direction, just leaves headroom unused - not
// worth the added complexity of a per-property throttle unless real volume
// ever needs it.
//
// pushAriForDateRange now makes TWO HTTP calls per invocation (restrictions,
// then availability - see channex-ari.ts), so "one call" below means one
// invocation, i.e. two real requests. MIN_MS_BETWEEN_CALLS is set so that
// even the worst case - every eligible row landing on the SAME property in
// one run - cannot push either endpoint's own 10/minute bucket over its
// limit: 60_000 / 10 = 6000ms between invocations, not 3500ms.
//
// Backoff: a failed range's contributing rows get attempts+1 and a
// nextAttemptAt pushed out exponentially, so a persistent failure is not
// hammered every drain cycle. After MAX_ATTEMPTS they flip to FAILED - a
// terminal state that stops automatic retries and stays visible (queryable,
// not silently dropped) rather than swallowed.
//
// Retryable vs permanent: every failure used to get the same backoff-then-
// FAILED treatment regardless of cause. That is wrong for a 422 - a mapping
// error, a malformed value - which will return the exact same 422 on every
// retry. Five attempts spread across roughly half an hour just delayed the
// terminal state that was already certain on attempt one, and for that
// window the row sat PENDING looking like a transient problem instead of
// the actual mismatch it was. ChannexError.retryable (429 or 5xx) is the
// same distinction sendSmoobuGuestMessage already draws for its own
// retries - now applied here too: retryable errors still back off and
// retry up to MAX_ATTEMPTS, anything else fails on the first attempt. An
// error this code cannot classify (a thrown non-ChannexError - a network
// timeout, say) is treated as retryable, since assuming permanent failure
// for an error whose cause is unknown risks discarding a row that would
// have succeeded on retry.

const MAX_CALLS_PER_RUN = 15; // stays under ~20/min even if the cron fires every minute
const MIN_MS_BETWEEN_CALLS = 6500; // 60_000 / 10 = 6000ms (the smaller of the two per-endpoint buckets); padded for safety
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000; // 1 min, 2 min, 4 min, 8 min, 16 min

function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** (attempts - 1);
}

interface Range {
  from: Date;
  to: Date;
}

// Merges overlapping or touching ranges into the minimal covering set.
// Exported for direct testing - this is the piece the "30 rapid edits
// should coalesce" exit criterion is actually about.
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.from.getTime() - b.from.getTime());
  const merged: Range[] = [{ from: sorted[0].from, to: sorted[0].to }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.from.getTime() <= last.to.getTime()) {
      if (cur.to.getTime() > last.to.getTime()) last.to = cur.to;
    } else {
      merged.push({ from: cur.from, to: cur.to });
    }
  }
  return merged;
}

export interface DrainSummary {
  eligibleRows: number;
  propertiesTouched: number;
  callsMade: number;
  callsSucceeded: number;
  callsFailed: number;
  rowsDone: number;
  rowsFailedTerminally: number;
  stoppedEarly: boolean; // hit MAX_CALLS_PER_RUN with more eligible work left
}

export async function drainAriOutbox(): Promise<DrainSummary> {
  const now = new Date();
  const eligible = await prisma.ariOutbox.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });

  const summary: DrainSummary = {
    eligibleRows: eligible.length,
    propertiesTouched: 0,
    callsMade: 0,
    callsSucceeded: 0,
    callsFailed: 0,
    rowsDone: 0,
    rowsFailedTerminally: 0,
    stoppedEarly: false,
  };
  if (eligible.length === 0) return summary;

  const byProperty = new Map<string, typeof eligible>();
  for (const row of eligible) {
    if (!byProperty.has(row.propertyId)) byProperty.set(row.propertyId, []);
    byProperty.get(row.propertyId)!.push(row);
  }

  let lastCallAt = 0;
  const throttle = async () => {
    const wait = lastCallAt === 0 ? 0 : MIN_MS_BETWEEN_CALLS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  };

  outer: for (const [propertyId, rows] of byProperty) {
    summary.propertiesTouched++;
    const merged = mergeRanges(rows.map((r) => ({ from: r.dateFrom, to: r.dateTo })));

    for (const range of merged) {
      if (summary.callsMade >= MAX_CALLS_PER_RUN) {
        summary.stoppedEarly = true;
        break outer;
      }

      // Every row whose range falls inside this merged range is settled by
      // this one call, regardless of which property-level rows produced it.
      const contributing = rows.filter((r) => r.dateFrom >= range.from && r.dateTo <= range.to);

      await throttle();
      summary.callsMade++;
      try {
        await pushAriForDateRange(propertyId, range.from, range.to);
        summary.callsSucceeded++;
        await prisma.ariOutbox.updateMany({
          where: { id: { in: contributing.map((r) => r.id) } },
          data: { status: "DONE", lastError: null },
        });
        summary.rowsDone += contributing.length;
      } catch (err) {
        summary.callsFailed++;
        const message = err instanceof Error ? err.message : String(err);
        // Unknown-shaped errors default to retryable - see the module
        // comment on why guessing "permanent" for an unclassified error is
        // the riskier default.
        const retryable = !(err instanceof ChannexError) || err.retryable;
        for (const row of contributing) {
          const attempts = row.attempts + 1;
          // A non-retryable error is terminal on the FIRST attempt: no
          // amount of backoff changes a 422, so there is nothing to wait
          // for. A retryable one still gets the normal budget.
          const givingUp = !retryable || attempts >= MAX_ATTEMPTS;
          await prisma.ariOutbox.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: message.slice(0, 500),
              status: givingUp ? "FAILED" : "PENDING",
              nextAttemptAt: givingUp ? null : new Date(Date.now() + backoffMs(attempts)),
            },
          });
          if (givingUp) summary.rowsFailedTerminally++;
        }
        console.error(
          `[drain-ari] property ${propertyId} range ${range.from.toISOString()}..${range.to.toISOString()} failed ` +
            `(${retryable ? "retryable" : "permanent"}):`,
          err
        );
      }
    }
  }

  return summary;
}
