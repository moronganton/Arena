import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { upsertReservationsFromChannexRevision } from "@/lib/channels/channex-bookings";

// Re-runs the booking->reservation upsert for deliveries that already sat in
// ChannexWebhookLog before that logic existed (task #10 shipped before task
// #11's processing did, so the first real deliveries only got stored, never
// turned into reservations). Also doubles as a manual retry for any delivery
// that failed processing since.
//
//   GET /api/debug/channex-reprocess-webhooks              -> dry run, lists candidates
//   GET /api/debug/channex-reprocess-webhooks?confirm=true  -> actually processes them
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const candidates = await prisma.channexWebhookLog.findMany({
    where: { event: "booking", reservationId: null },
    orderBy: { createdAt: "asc" },
  });

  const revisionIds = candidates
    .map((c) => {
      try {
        return (JSON.parse(c.payload) as { payload?: { revision_id?: string } })?.payload?.revision_id ?? null;
      } catch {
        return null;
      }
    })
    .filter((id): id is string => !!id);

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing changed",
      candidateDeliveries: candidates.length,
      revisionIds,
    });
  }

  const results: Array<{ revisionId: string; reservationIds: string[]; skipped: string[] } | { revisionId: string; error: string }> = [];
  for (const revisionId of revisionIds) {
    try {
      const { reservationIds, skipped } = await upsertReservationsFromChannexRevision(revisionId);
      results.push({ revisionId, reservationIds, skipped });
      const log = candidates.find((c) => c.payload.includes(revisionId));
      if (log && reservationIds[0]) {
        await prisma.channexWebhookLog.update({ where: { id: log.id }, data: { reservationId: reservationIds[0] } });
      }
    } catch (err) {
      results.push({ revisionId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    applied: true,
    processed: results.length,
    results,
  });
}
