import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { fetchChannexRevision } from "@/lib/channels/channex-bookings";

// Reads one booking revision in full, untruncated - specifically the
// rooms[] array, which is where room_type_id/rate_plan_id live and which
// the general-purpose channex-probe cuts off at its 1500-char excerpt limit
// before reaching. Needed to compare what room a "new" revision mapped to
// against what a later "modified" revision maps to, since the two have been
// seen to differ for the same booking.
//
//   GET /api/debug/channex-revision-detail?revisionId=xxx
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const revisionId = new URL(req.url).searchParams.get("revisionId");
  if (!revisionId) return NextResponse.json({ error: "revisionId is required" }, { status: 400 });

  try {
    const attrs = await fetchChannexRevision(revisionId);
    return NextResponse.json({
      revisionId,
      status: attrs.status,
      arrival: (attrs as unknown as { arrival_date?: string }).arrival_date,
      departure: (attrs as unknown as { departure_date?: string }).departure_date,
      rooms: attrs.rooms.map((r) => ({
        booking_room_id: r.booking_room_id,
        room_type_id: r.room_type_id,
        rate_plan_id: r.rate_plan_id,
        checkin_date: r.checkin_date,
        checkout_date: r.checkout_date,
        is_cancelled: r.is_cancelled,
        meta: r.meta,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
