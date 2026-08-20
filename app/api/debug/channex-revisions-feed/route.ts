import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexGet, ChannexError } from "@/lib/channels/channex-core";

// Shows the unacknowledged booking-revision feed with its identifiers laid
// out plainly.
//
// Acknowledging the wrong id silently leaves a booking in the feed forever,
// and a revision carries three ids that are easy to confuse: the revision's
// own id, the booking it revises, and the OTA's reservation code. Only the
// first is what /ack takes. The general probe truncates its response before
// the envelope-level id is visible, so this reports the identifiers directly
// rather than leaving that to a guess.
//
//   GET /api/debug/channex-revisions-feed
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  try {
    const res = await channexGet<
      Array<{
        id?: string;
        type?: string;
        attributes?: { id?: string; booking_id?: string; unique_id?: string; property_id?: string; status?: string; revision_id?: string };
      }>
    >("/booking_revisions/feed?order[inserted_at]=asc");

    const rows = res.data ?? [];
    return NextResponse.json({
      unacknowledged: rows.length,
      meta: res.meta ?? null,
      // Both levels, side by side, so which one /ack wants is a fact rather
      // than an assumption.
      identifiers: rows.slice(0, 10).map((r) => ({
        envelopeId: r.id ?? null,
        envelopeType: r.type ?? null,
        attributesId: r.attributes?.id ?? null,
        bookingId: r.attributes?.booking_id ?? null,
        revisionIdField: r.attributes?.revision_id ?? null,
        otaCode: r.attributes?.unique_id ?? null,
        status: r.attributes?.status ?? null,
      })),
    });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, status: e.status, code: e.code, details: e.details }, { status: 500 });
  }
}
