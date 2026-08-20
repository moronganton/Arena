import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";
import { upsertReservationsFromBookingData, type ChannexBookingAttributes } from "@/lib/channels/channex-bookings";

// Reads bookings from the unacknowledged revision feed and acknowledges each
// one once it is safely stored.
//
// Two things Channex requires, both previously missing here. It names the
// endpoint outright - "be sure that you do not use GET api/v1/bookings...
// endpoints, use GET api/v1/booking_revisions... instead" - and it makes
// acknowledgement a condition of certification: "Be sure that you send
// Booking Acknowledge message. It is required step for certification."
//
// The feed only ever returns revisions that have not been acknowledged, so
// acknowledgement is not bookkeeping - it is what advances the cursor. Skip it
// and the same booking is redelivered every thirty minutes forever.
//
// A revision is one message from an OTA; a booking is the latest of them.
// That is why a new booking, a modification and a cancellation are three
// revisions of one booking, and why the revision is what gets acknowledged.

const FEED_PAGE_LIMIT = 10; // Channex's own page size for this endpoint
const MAX_BATCHES = 20; // 200 revisions in one run is far beyond a normal backlog

export interface ChannexRevisionsPollResult {
  fetched: number;
  reservationsTouched: number;
  acknowledged: number;
  skippedButAcknowledged: number;
  leftForRetry: number;
  errors: string[];
}

interface RevisionEnvelope {
  id: string;
  type: string;
  attributes: ChannexBookingAttributes;
}

// Oldest first, so a booking and its later modification are applied in the
// order they happened rather than the modification overwriting the original.
//
// Always the first page, never page 2. The feed contains only unacknowledged
// revisions, so acknowledging one removes it - which means the next batch is
// always at the front. Paging forward through a list that shrinks underneath
// you skips exactly as many items as you just acknowledged.
async function fetchFeedBatch(): Promise<RevisionEnvelope[]> {
  const res = await channexGet<RevisionEnvelope[]>(
    `/booking_revisions/feed?order[inserted_at]=asc&pagination[page]=1&pagination[limit]=${FEED_PAGE_LIMIT}`
  );
  return res.data ?? [];
}

export async function acknowledgeRevision(revisionId: string): Promise<void> {
  await channexPost(`/booking_revisions/${revisionId}/ack`, {});
}

export async function pollChannexRevisions(): Promise<ChannexRevisionsPollResult> {
  const result: ChannexRevisionsPollResult = {
    fetched: 0,
    reservationsTouched: 0,
    acknowledged: 0,
    skippedButAcknowledged: 0,
    leftForRetry: 0,
    errors: [],
  };

  const seen = new Set<string>();

  for (let batchNo = 1; batchNo <= MAX_BATCHES; batchNo++) {
    let batch: RevisionEnvelope[];
    try {
      batch = await fetchFeedBatch();
    } catch (err) {
      const e = err as ChannexError;
      result.errors.push(`feed batch ${batchNo}: ${e.message}`);
      break;
    }
    if (batch.length === 0) break;

    // A revision left unacknowledged after a failure stays at the front of
    // the feed and would be handed back forever. Stopping when a batch brings
    // nothing new is what ends the loop in that case.
    let added = 0;

    for (const rev of batch) {
      if (seen.has(rev.id)) continue;
      seen.add(rev.id);
      added++;
      result.fetched++;

      try {
        const { reservationIds, skipped } = await upsertReservationsFromBookingData(rev.attributes);
        result.reservationsTouched += reservationIds.length;

        if (reservationIds.length > 0) {
          await acknowledgeRevision(rev.id);
          result.acknowledged++;
        } else {
          // Nothing was stored, but nothing ever will be either: the booking
          // is for a room we do not map or a property not on Channex. Retrying
          // cannot change that, and leaving it unacknowledged would keep it in
          // the feed indefinitely, ahead of bookings that do matter. So it is
          // acknowledged deliberately, and the reason is recorded.
          await acknowledgeRevision(rev.id);
          result.skippedButAcknowledged++;
          console.log(
            `[channex-revisions] revision ${rev.id} acknowledged without storing: ${skipped.join("; ") || "no mapped rooms"}`
          );
        }
      } catch (err) {
        // Deliberately NOT acknowledged. This is the case acknowledgement
        // exists for - the booking stays in the feed and comes back next run,
        // rather than being lost because we said we had it.
        const message = err instanceof Error ? err.message : String(err);
        result.leftForRetry++;
        result.errors.push(`revision ${rev.id}: ${message}`);
        console.error(`[channex-revisions] revision ${rev.id} failed, left unacknowledged:`, err);
      }
    }

    if (added === 0) break;
  }

  return result;
}

// Bookings that arrived by webhook but were never acknowledged - anything
// stored before acknowledgement existed. They are no longer in the feed's
// future, but Channex still considers them outstanding.
export async function acknowledgeStoredButUnacked(): Promise<{ acknowledged: number; errors: string[] }> {
  const logs = await prisma.channexWebhookLog.findMany({
    where: { event: "booking", processedOk: true, reservationId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let acknowledged = 0;
  const errors: string[] = [];
  const done = new Set<string>();

  for (const log of logs) {
    let revisionId: string | null = null;
    try {
      revisionId = (JSON.parse(log.payload) as { payload?: { revision_id?: string } })?.payload?.revision_id ?? null;
    } catch {
      continue;
    }
    if (!revisionId || done.has(revisionId)) continue;
    done.add(revisionId);

    try {
      await acknowledgeRevision(revisionId);
      acknowledged++;
    } catch (err) {
      const e = err as ChannexError;
      // A revision already acknowledged, or long gone, is not a problem worth
      // reporting - the goal is simply that it is no longer outstanding.
      if (e.status === 404 || e.status === 422) continue;
      errors.push(`${revisionId}: ${e.message}`);
    }
  }

  return { acknowledged, errors };
}
