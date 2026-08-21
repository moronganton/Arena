import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { upsertReservationsFromChannexRevision } from "@/lib/channels/channex-bookings";

// Reprocesses exactly ONE revision by id, regardless of its ack state or
// whether it was already (mistakenly) acknowledged without being stored.
//
// Exists for a real gap the bulk /channex-reprocess-webhooks endpoint does
// not cover well: a booking whose room was unmapped in Channex at delivery
// time gets skipped, and the webhook route still acknowledges it, on the
// (wrong, for this case) assumption that an unstorable booking will never
// become storable. A room mapping is exactly the kind of thing a human can
// go fix after the fact - and once fixed, Channex will not redeliver an
// already-acked revision through the normal feed. This is the manual path
// back for that one booking, scoped to it alone rather than reprocessing
// every historically-skipped delivery on the property.
//
// fetchChannexRevision reads the revision by id directly from Channex,
// independent of ack state or the feed - the booking data itself is still
// there, only the feed's queue has moved past it.
//
//   GET /api/debug/channex-reprocess-revision?revisionId=xxx
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const revisionId = new URL(req.url).searchParams.get("revisionId");
  if (!revisionId) return NextResponse.json({ error: "revisionId is required" }, { status: 400 });

  try {
    const { reservationIds, skipped } = await upsertReservationsFromChannexRevision(revisionId);

    if (reservationIds[0]) {
      const log = await prisma.channexWebhookLog.findFirst({
        where: { event: "booking", payload: { contains: revisionId } },
      });
      if (log) {
        await prisma.channexWebhookLog.update({
          where: { id: log.id },
          data: { processedOk: true, reservationId: reservationIds[0], error: null },
        });
      }
    }

    return NextResponse.json({ revisionId, reservationIds, skipped });
  } catch (err) {
    return NextResponse.json(
      { revisionId, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
