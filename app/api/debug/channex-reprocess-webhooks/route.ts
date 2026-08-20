import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertReservationsFromChannexBooking } from "@/lib/channels/channex-bookings";

// Re-runs the booking->reservation upsert for deliveries that already sat in
// ChannexWebhookLog before that logic existed (task #10 shipped before task
// #11's processing did, so the first real deliveries only got stored, never
// turned into reservations). Also doubles as a manual retry for any delivery
// that failed processing since.
//
//   GET /api/debug/channex-reprocess-webhooks              -> dry run, lists candidates
//   GET /api/debug/channex-reprocess-webhooks?confirm=true  -> actually processes them
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const candidates = await prisma.channexWebhookLog.findMany({
    where: { event: "booking", reservationId: null },
    orderBy: { createdAt: "asc" },
  });

  const bookingIds = candidates
    .map((c) => {
      try {
        return (JSON.parse(c.payload) as { payload?: { booking_id?: string } })?.payload?.booking_id ?? null;
      } catch {
        return null;
      }
    })
    .filter((id): id is string => !!id);

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing changed",
      candidateDeliveries: candidates.length,
      bookingIds,
    });
  }

  const results: Array<{ bookingId: string; reservationIds: string[]; skipped: string[] } | { bookingId: string; error: string }> = [];
  for (const bookingId of bookingIds) {
    try {
      const { reservationIds, skipped } = await upsertReservationsFromChannexBooking(bookingId);
      results.push({ bookingId, reservationIds, skipped });
      const log = candidates.find((c) => c.payload.includes(bookingId));
      if (log && reservationIds[0]) {
        await prisma.channexWebhookLog.update({ where: { id: log.id }, data: { reservationId: reservationIds[0] } });
      }
    } catch (err) {
      results.push({ bookingId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    applied: true,
    processed: results.length,
    results,
  });
}
