// Picking up bookings that arrived before Channex had finished resolving them.
//
// Channex fires the booking webhook the instant a booking lands, but its own
// room-code -> room_type_id/rate_plan_id resolution finishes slightly after
// that. channex-bookings.ts retries for ~17s, which covers the usual case.
// When it does not, the delivery is skipped AND the revision is acknowledged -
// deliberately, so a booking that can never be mapped does not redeliver
// forever. Channex will not re-send an acknowledged revision, so the stay is
// then invisible: no reservation, the nights never become occupied, and the
// next ARI push reports them available again. A confirmed guest, and the room
// back on sale on every channel.
//
// Seen live: a booking skipped at 14:49 that resolved cleanly when the same
// revision was fetched again minutes later, with no code change in between.
//
// This is the sweep that catches those. The selection is pure so the rules
// that decide what gets retried - and what is left alone - are testable
// without a database or a network.

export interface WebhookLogRow {
  id: string;
  payload: string;
  createdAt: Date;
  reservationId: string | null;
}

export interface ReconcileCandidate {
  logId: string;
  revisionId: string;
  propertyId: string;
}

/** What a booking webhook body carries, as far as this needs to care. */
function parsePayload(raw: string): { revisionId: string; propertyId: string } | null {
  try {
    const body = JSON.parse(raw) as {
      payload?: { revision_id?: string; property_id?: string };
    };
    const revisionId = body?.payload?.revision_id;
    const propertyId = body?.payload?.property_id;
    if (!revisionId || !propertyId) return null;
    return { revisionId, propertyId };
  } catch {
    return null;
  }
}

/**
 * Which deliveries are worth retrying now.
 *
 * Three bounds, each for a different failure this would otherwise cause:
 *
 *   OWN PROPERTIES ONLY. The Booking.com sandbox hotels are shared between
 *   testers, so bookings arrive for properties nobody here manages. Those can
 *   never resolve, and retrying them every sweep would spend the whole budget
 *   on other people's data.
 *
 *   A TIME WINDOW. Resolution takes seconds, occasionally minutes. Anything
 *   still unresolved after the window is not a race, it is a booking that
 *   genuinely cannot be mapped - and retrying it daily forever turns a
 *   one-time gap into a permanent load.
 *
 *   A CAP. One sweep should not be able to run for an unbounded time; the
 *   remainder is simply picked up by the next one.
 */
export function selectReconcileCandidates(
  rows: WebhookLogRow[],
  ownChannexPropertyIds: Set<string>,
  now: Date,
  windowHours = 48,
  cap = 25
): ReconcileCandidate[] {
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  const out: ReconcileCandidate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.reservationId) continue; // already landed
    if (row.createdAt.getTime() < cutoff) continue;

    const parsed = parsePayload(row.payload);
    if (!parsed) continue;
    if (!ownChannexPropertyIds.has(parsed.propertyId)) continue;

    // Channex can deliver the same revision more than once; retrying it twice
    // in one sweep is wasted work, not a second chance.
    if (seen.has(parsed.revisionId)) continue;
    seen.add(parsed.revisionId);

    out.push({ logId: row.id, revisionId: parsed.revisionId, propertyId: parsed.propertyId });
    if (out.length >= cap) break;
  }

  return out;
}

/**
 * Run the sweep: retry each candidate, and record the ones that landed.
 *
 * Idempotent by construction - upsertReservationsFromChannexRevision keys on
 * the reservation's external id, so a revision processed twice updates one
 * stay rather than creating a second. That matters because a delivery can be
 * picked up here at the same moment Channex redelivers it.
 */
export async function reconcileUnlandedBookings(opts: {
  windowHours?: number;
  cap?: number;
  now?: Date;
} = {}): Promise<{
  examined: number;
  retried: number;
  recovered: { revisionId: string; reservationIds: string[] }[];
  stillUnresolved: { revisionId: string; reason: string }[];
}> {
  const { prisma } = await import("@/lib/prisma");
  const { upsertReservationsFromChannexRevision } = await import("./channex-bookings");

  const now = opts.now ?? new Date();
  const windowHours = opts.windowHours ?? 48;

  const [rows, listings] = await Promise.all([
    prisma.channexWebhookLog.findMany({
      where: {
        event: "booking",
        reservationId: null,
        createdAt: { gte: new Date(now.getTime() - windowHours * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, payload: true, createdAt: true, reservationId: true },
    }),
    prisma.channexListing.findMany({ select: { channexPropertyId: true } }),
  ]);

  const own = new Set(listings.map((l) => l.channexPropertyId));
  const candidates = selectReconcileCandidates(rows, own, now, windowHours, opts.cap);

  const recovered: { revisionId: string; reservationIds: string[] }[] = [];
  const stillUnresolved: { revisionId: string; reason: string }[] = [];

  for (const c of candidates) {
    try {
      const { reservationIds, skipped } = await upsertReservationsFromChannexRevision(c.revisionId);
      if (reservationIds.length > 0) {
        recovered.push({ revisionId: c.revisionId, reservationIds });
        // Marking the log row is what stops the next sweep picking it up.
        await prisma.channexWebhookLog.update({
          where: { id: c.logId },
          data: { reservationId: reservationIds[0], error: null },
        });
      } else {
        stillUnresolved.push({ revisionId: c.revisionId, reason: skipped.join("; ") || "no rooms matched" });
      }
    } catch (err) {
      stillUnresolved.push({
        revisionId: c.revisionId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (recovered.length > 0) {
    console.log(
      `[booking-reconcile] recovered ${recovered.length} booking(s) that arrived before Channex resolved them: ` +
        recovered.map((r) => r.revisionId).join(", ")
    );
  }

  return { examined: rows.length, retried: candidates.length, recovered, stillUnresolved };
}
