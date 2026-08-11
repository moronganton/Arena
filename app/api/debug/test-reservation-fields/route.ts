import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// The SmoobuBooking TypeScript interface in lib/channels/smoobu.ts only
// declares the fields the sync code currently reads - it says nothing about
// what Smoobu's API actually sends back. This checks real reservations'
// COMPLETE raw JSON so "does Smoobu give us commission data" is answered by
// looking at the real response, not by guessing from what we parse.
// Read-only, session-gated like its siblings.
//
//   GET /api/debug/test-reservation-fields[?propertyId=...]
//     -> a summary table across every matching reservation in the window,
//        so one null/odd field on a single booking isn't mistaken for a
//        pattern - the first check landed on a booking with several nulls
//        (email, phone, adults, children all missing), so this checks
//        whether that was typical or an outlier before concluding anything.
//
//   GET /api/debug/test-reservation-fields?reservationId=<smoobu id>
//     -> full raw JSON (list + detail view) for that ONE reservation, same
//        as the original single-booking dump, for drilling into a specific one.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const wantProperty = searchParams.get("propertyId");
  const wantReservationId = searchParams.get("reservationId");

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
  const to = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

  async function get(path: string) {
    const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
      headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  const commissionLike = (obj: Record<string, unknown> | null) =>
    obj ? Object.keys(obj).filter((k) => /commission|fee|net|payout/i.test(k)) : [];

  try {
    const list = await get(`/reservations?from=${from}&to=${to}&page=1&pageSize=100&showCancellation=true`);
    const bookings: Array<Record<string, unknown>> = list.bookings || [];
    const matches = bookings.filter((b) => String((b.apartment as { id?: number } | undefined)?.id ?? "") === mapping.listingId);
    if (matches.length === 0) {
      return NextResponse.json({ error: `No reservation found for ${mapping.property.name} in this window.` }, { status: 404 });
    }

    // --- single-reservation deep dive ---
    if (wantReservationId) {
      const match = matches.find((b) => String(b.id) === wantReservationId);
      if (!match) return NextResponse.json({ error: `Reservation ${wantReservationId} not found for this property in this window.` }, { status: 404 });

      let detail: Record<string, unknown> | null = null;
      let detailError: string | null = null;
      try {
        detail = await get(`/reservations/${match.id}`);
      } catch (err) {
        detailError = err instanceof Error ? err.message : String(err);
      }

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
    }

    // --- summary across every matching reservation ---
    const summary = matches.map((b) => ({
      id: b.id,
      arrival: b.arrival,
      departure: b.departure,
      guest: b["guest-name"],
      channel: (b.channel as { name?: string } | undefined)?.name,
      price: b.price,
      commissionIncluded: b["commission-included"],
      pricePaid: b["price-paid"],
      prepaymentPaid: b["prepayment-paid"],
      depositPaid: b["deposit-paid"],
      cityTax: b["city-tax"],
      hasEmail: b.email != null,
      hasPhone: b.phone != null,
      hasAdults: b.adults != null,
    }));

    const nonNullCommission = summary.filter((r) => r.commissionIncluded != null).length;
    const nonNullCityTax = summary.filter((r) => r.cityTax != null).length;

    return NextResponse.json({
      property: mapping.property.name,
      queriedFrom: from,
      queriedTo: to,
      reservationCount: matches.length,
      summary,
      pattern: {
        commissionIncludedPopulated: `${nonNullCommission} of ${matches.length}`,
        cityTaxPopulated: `${nonNullCityTax} of ${matches.length}`,
      },
      verdict:
        nonNullCommission === 0
          ? `commission-included is null on all ${matches.length} reservations checked, not just one - confirms Smoobu is not tracking commission data for this account, at least not via this field.`
          : `commission-included IS populated on ${nonNullCommission} of ${matches.length} - worth checking one of those directly with ?reservationId=<id> to see what value it actually holds.`,
      hint: "Add &reservationId=<id from the summary above> to this URL for the complete raw JSON of one specific reservation.",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
