import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// The SmoobuBooking TypeScript interface in lib/channels/smoobu.ts only
// declares the fields the sync code currently reads - it says nothing about
// what Smoobu's API actually sends back. This dumps a real reservation's
// COMPLETE raw JSON (list view and, if available, the /reservations/{id}
// detail view) so "does Smoobu even give us commission data" can be answered
// by looking at the real response instead of guessing from what we parse.
// Read-only, session-gated like its siblings.
//   GET /api/debug/test-reservation-fields[?propertyId=...]
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const wantProperty = new URL(req.url).searchParams.get("propertyId");
  const mapping = await prisma.channelConfig.findFirst({
    where: {
      channel: "SMOOBU",
      property: { ownerId: session.user.id },
      ...(wantProperty ? { propertyId: wantProperty } : { listingId: { not: null } }),
    },
    include: { property: { select: { name: true } } },
  });
  if (!mapping?.listingId) return NextResponse.json({ error: "No Smoobu-mapped property found" }, { status: 404 });

  const cred = parseCredential(account.apiKey);
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  async function get(path: string) {
    const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
      headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  try {
    const list = await get(`/reservations?from=${from}&to=${to}&page=1&pageSize=100&showCancellation=true`);
    const bookings: Array<Record<string, unknown>> = list.bookings || [];
    const match = bookings.find((b) => String((b.apartment as { id?: number } | undefined)?.id ?? "") === mapping.listingId);
    if (!match) {
      return NextResponse.json({ error: `No reservation found for ${mapping.property.name} in the last 90 days to check.` }, { status: 404 });
    }

    let detail: Record<string, unknown> | null = null;
    let detailError: string | null = null;
    try {
      detail = await get(`/reservations/${match.id}`);
    } catch (err) {
      detailError = err instanceof Error ? err.message : String(err);
    }

    const commissionLike = (obj: Record<string, unknown> | null) =>
      obj ? Object.keys(obj).filter((k) => /commission|fee|net|payout/i.test(k)) : [];

    return NextResponse.json({
      property: mapping.property.name,
      reservationChecked: match.id,
      listViewAllKeys: Object.keys(match),
      listViewFull: match,
      detailViewAllKeys: detail ? Object.keys(detail) : null,
      detailViewFull: detail,
      detailError,
      commissionOrFeeRelatedKeysFound: {
        inListView: commissionLike(match),
        inDetailView: commissionLike(detail),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
