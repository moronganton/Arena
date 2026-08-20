import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// Answers a specific question: for a Smoobu-mapped property whose earliest
// reservation in StayHQ looks suspiciously recent, is that because
// syncSmoobuBookings failed to pull older bookings Smoobu actually has, or
// because Smoobu itself has no record of them (e.g. the listing was only
// connected to Smoobu recently, and channel managers generally do not
// backfill an OTA's pre-connection booking history)?
//
// Queries Smoobu's real /reservations endpoint the same way
// syncSmoobuBookings does (same auth, same query shape) but with a much wider
// date window, then reports what Smoobu itself has for this apartment versus
// what already exists in StayHQ - so the answer is read from the source of
// truth rather than inferred from StayHQ's own database.
//   GET /api/debug/test-reservation-history?propertyId=...&from=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: userId } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const wantProperty = searchParams.get("propertyId");
  // Default lookback is generous - a full year - specifically so this can
  // answer "does Smoobu have anything before X" without needing to guess X.
  const from = searchParams.get("from") || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  const mapping = await prisma.channelConfig.findFirst({
    where: {
      channel: "SMOOBU",
      property: { ownerId: userId },
      ...(wantProperty ? { propertyId: wantProperty } : { listingId: { not: null } }),
    },
    include: { property: { select: { id: true, name: true } } },
  });
  if (!mapping?.listingId) return NextResponse.json({ error: "No Smoobu-mapped property found" }, { status: 404 });
  const apartmentId = mapping.listingId;

  const cred = parseCredential(account.apiKey);

  // Same endpoint, same query shape as syncSmoobuBookings - only the date
  // window and the fact that this only reads are different.
  async function fetchSmoobuReservations(fromDate: string, toDate: string) {
    const all: Array<{ id: number; arrival: string; departure: string; apartment?: { id: number }; type?: string }> = [];
    let page = 1;
    let pageCount = 1;
    while (page <= Math.min(pageCount, 20)) {
      const path = `/reservations?from=${fromDate}&to=${toDate}&page=${page}&pageSize=100&showCancellation=true`;
      const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
        headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error(`Smoobu /reservations HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      pageCount = data.page_count || 1;
      all.push(...(data.bookings || []));
      page++;
    }
    return all.filter((b) => String(b.apartment?.id ?? "") === apartmentId);
  }

  try {
    const [wideWindow, productionWindow] = await Promise.all([
      fetchSmoobuReservations(from, to),
      // Exactly reproduces what syncSmoobuBookings itself computes today, so
      // this can confirm or refute the 90-day window independently of the
      // wide-window figure above.
      fetchSmoobuReservations(
        new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        new Date(Date.now() + 540 * 86400000).toISOString().slice(0, 10)
      ),
    ]);

    const inStayHQ = await prisma.reservation.findMany({
      where: { propertyId: mapping.propertyId },
      select: { externalId: true, checkIn: true, checkOut: true },
    });
    const stayHQIds = new Set(inStayHQ.map((r) => r.externalId));

    const sorted = [...wideWindow].sort((a, b) => a.arrival.localeCompare(b.arrival));
    const missingFromStayHQ = sorted.filter((b) => !stayHQIds.has(`smoobu-${b.id}`));

    return NextResponse.json({
      property: mapping.property.name,
      apartmentId,
      queriedFrom: from,
      queriedTo: to,
      smoobuReservationCountInWideWindow: wideWindow.length,
      earliestArrivalSmoobuHasOnRecord: sorted[0]?.arrival ?? null,
      latestArrivalSmoobuHasOnRecord: sorted[sorted.length - 1]?.arrival ?? null,
      productionWindow: {
        from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        to: new Date(Date.now() + 540 * 86400000).toISOString().slice(0, 10),
        smoobuReservationCount: productionWindow.length,
      },
      reservationsInStayHQForThisProperty: inStayHQ.length,
      earliestCheckInInStayHQ: inStayHQ.length
        ? inStayHQ.reduce((min, r) => (r.checkIn < min ? r.checkIn : min), inStayHQ[0].checkIn).toISOString().slice(0, 10)
        : null,
      missingFromStayHQCount: missingFromStayHQ.length,
      missingFromStayHQSample: missingFromStayHQ.slice(0, 10).map((b) => ({
        smoobuId: b.id, arrival: b.arrival, departure: b.departure, cancelled: (b.type || "").toLowerCase().includes("cancel"),
      })),
      verdict:
        missingFromStayHQ.length === 0
          ? "Smoobu's own records for this apartment do not go back further than what's already in StayHQ. This is not a sync bug - Smoobu itself has nothing earlier, most likely because the listing was only connected to Smoobu recently and channel managers don't retroactively pull an OTA's pre-connection booking history. The bulk-import tool is the correct way to backfill anything before this point."
          : `Smoobu HAS ${missingFromStayHQ.length} reservation(s) on record that never made it into StayHQ (see missingFromStayHQSample) - this points at a real gap in syncSmoobuBookings, not a Smoobu-side data limit. Worth investigating why these specific ones were skipped.`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
