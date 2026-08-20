import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// Thorough duplicate hunt across the WHOLE portfolio, not one month.
//
// The earlier count check keyed duplicates on property + exact dates, which has
// two blind spots this covers:
//   - a stay recorded against two different Property rows (a "(copy)" property
//     exists, so the same real stay can sit on both and never collide)
//   - a stay recorded twice with dates off by a day, which an exact-date match
//     never sees
//
// The strongest signal is OVERLAPPING stays on one property: two guests cannot
// occupy one apartment on the same night, so any overlap is either a real
// double-booking or - far more likely - one stay stored twice. Note the
// importer and the live sync use different id schemes (Booking.com's Book
// Number vs Smoobu's internal id), so a duplicated stay shares neither
// confirmationCode nor externalId and can only be found by its dates.
//
//   GET /api/debug/find-duplicate-reservations[?from=2026-07-01&to=2026-10-01]
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date("2026-01-01");
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : new Date("2027-01-01");

  const all = await prisma.reservation.findMany({
    where: {
      property: { ownerId: userId },
      checkOut: { gte: from, lt: to },
    },
    include: { guest: { select: { name: true } }, property: { select: { id: true, name: true } } },
    orderBy: [{ propertyId: "asc" }, { checkIn: "asc" }],
  });

  const view = (r: (typeof all)[number]) => ({
    id: r.id,
    guest: r.guest.name,
    property: r.property.name,
    propertyId: r.property.id,
    checkIn: r.checkIn.toISOString().slice(0, 10),
    checkOut: r.checkOut.toISOString().slice(0, 10),
    status: r.status,
    amount: r.totalAmount,
    confirmationCode: r.confirmationCode,
    externalId: r.externalId,
    createdAt: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
  });

  const isLive = (s: string) => s !== "CANCELLED" && s !== "NO_SHOW";
  const live = all.filter((r) => isLive(r.status));
  const day = (d: Date) => d.getTime();

  // 1. Overlapping live stays on the SAME property - the definitive signal.
  const overlaps: Array<{ property: string; a: ReturnType<typeof view>; b: ReturnType<typeof view>; overlapNights: number }> = [];
  const byProperty = new Map<string, typeof live>();
  for (const r of live) {
    if (!byProperty.has(r.propertyId)) byProperty.set(r.propertyId, []);
    byProperty.get(r.propertyId)!.push(r);
  }
  for (const [, rows] of byProperty) {
    const sorted = [...rows].sort((a, b) => day(a.checkIn) - day(b.checkIn));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (day(b.checkIn) >= day(a.checkOut)) break; // sorted, so no later row can overlap either
        const nights = Math.round((Math.min(day(a.checkOut), day(b.checkOut)) - day(b.checkIn)) / 86400000);
        overlaps.push({ property: a.property.name, a: view(a), b: view(b), overlapNights: nights });
      }
    }
  }

  // 2. Same guest name appearing more than once anywhere (any property, any
  //    status) - catches a stay duplicated across the "(copy)" property.
  const byGuest = new Map<string, typeof all>();
  for (const r of all) {
    const key = r.guest.name.trim().toLowerCase();
    if (!byGuest.has(key)) byGuest.set(key, []);
    byGuest.get(key)!.push(r);
  }
  const repeatedGuests = Array.from(byGuest.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([name, rows]) => ({
      guest: name,
      count: rows.length,
      // Same guest twice is normal (a returning guest, or a cancel-then-rebook).
      // Flag only when it looks like one stay stored twice.
      looksDuplicated:
        rows.filter(isLiveRow).length > 1 &&
        rows.some((a, i) => rows.slice(i + 1).some((b) => datesClose(a, b))),
      rows: rows.map(view),
    }));

  function isLiveRow(r: (typeof all)[number]) { return isLive(r.status); }
  function datesClose(a: (typeof all)[number], b: (typeof all)[number]) {
    const within = (x: Date, y: Date) => Math.abs(day(x) - day(y)) <= 2 * 86400000;
    return isLive(a.status) && isLive(b.status) && within(a.checkIn, b.checkIn) && within(a.checkOut, b.checkOut);
  }

  // 3. Same property + same amount + check-ins within 2 days: a duplicated
  //    stay usually carries an identical price.
  const sameAmountNearby: Array<{ a: ReturnType<typeof view>; b: ReturnType<typeof view> }> = [];
  for (const [, rows] of byProperty) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (a.totalAmount == null || b.totalAmount == null) continue;
        if (Math.abs(a.totalAmount - b.totalAmount) > 0.01) continue;
        if (Math.abs(day(a.checkIn) - day(b.checkIn)) > 2 * 86400000) continue;
        sameAmountNearby.push({ a: view(a), b: view(b) });
      }
    }
  }

  // 3b. Identical dates on DIFFERENT properties. The portfolio contains a
  //     "(copy)" property, so one real stay can sit on both the original and
  //     the copy under slightly different guest spellings - which neither the
  //     overlap check (same property only) nor the guest-name check would see.
  const sameDatesAcrossProperties: Array<{ checkIn: string; checkOut: string; rows: ReturnType<typeof view>[] }> = [];
  const byDates = new Map<string, typeof live>();
  for (const r of live) {
    const key = `${r.checkIn.toISOString().slice(0, 10)}|${r.checkOut.toISOString().slice(0, 10)}`;
    if (!byDates.has(key)) byDates.set(key, []);
    byDates.get(key)!.push(r);
  }
  for (const [key, rows] of byDates) {
    if (rows.length < 2) continue;
    const [checkIn, checkOut] = key.split("|");
    sameDatesAcrossProperties.push({ checkIn, checkOut, rows: rows.map(view) });
  }

  // 3c. The same Booking.com Book Number (or Smoobu id) on more than one row.
  //     This is the unambiguous "imported twice" signature, and it is checked
  //     across the WHOLE portfolio and every status - the month-scoped check
  //     could not see a stay duplicated onto a second property. Blank codes are
  //     skipped: hand-created reservations all share the empty string.
  const byCode = new Map<string, typeof all>();
  for (const r of all) {
    const code = (r.confirmationCode || "").trim();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(r);
  }
  const duplicateCodes = Array.from(byCode.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([code, rows]) => ({ confirmationCode: code, count: rows.length, rows: rows.map(view) }));

  // Where the overlaps cluster. A month carrying several is a bad import
  // batch, not a stray double-booking.
  const overlapsByMonth: Record<string, number> = {};
  for (const o of overlaps) {
    const m = o.b.checkIn.slice(0, 7);
    overlapsByMonth[m] = (overlapsByMonth[m] || 0) + 1;
  }

  // 4. Every property with its live-reservation count - surfaces leftover or
  //    duplicated Property rows (e.g. an original alongside its "(copy)").
  const properties = await prisma.property.findMany({
    where: { ownerId: userId },
    select: {
      id: true, name: true, active: true, createdAt: true,
      _count: { select: { reservations: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 5. Per-property August checkout tally, to compare against a hand count.
  const augStart = new Date("2026-08-01T00:00:00Z");
  const augEnd = new Date("2026-09-01T00:00:00Z");
  const augustByProperty = properties.map((p) => {
    const rows = live.filter(
      (r) => r.propertyId === p.id && r.checkOut >= augStart && r.checkOut < augEnd
    );
    return {
      property: p.name,
      liveCheckoutsInAugust: rows.length,
      // Listed so the tally can be reconciled against a hand count line by line.
      stays: rows
        .sort((a, b) => day(a.checkOut) - day(b.checkOut))
        .map((r) => `${r.checkIn.toISOString().slice(5, 10)} -> ${r.checkOut.toISOString().slice(5, 10)}  ${r.guest.name}`),
    };
  });

  return NextResponse.json({
    scanned: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows: all.length, live: live.length },
    summary: {
      overlappingStaysOnSameProperty: overlaps.length,
      guestsAppearingMoreThanOnce: repeatedGuests.length,
      guestsThatLookDuplicated: repeatedGuests.filter((g) => g.looksDuplicated).length,
      samePropertySameAmountNearbyDates: sameAmountNearby.length,
      identicalDateRangesAcrossProperties: sameDatesAcrossProperties.length,
      sharedConfirmationCodes: duplicateCodes.length,
      totalProperties: properties.length,
    },
    overlapsByMonth,
    verdictHint:
      overlaps.length > 0
        ? "OVERLAP FOUND - two stays claim the same night on one property. Almost certainly the duplicate."
        : "No overlapping stays. Every apartment-night is claimed once, so the August rows are physically consistent.",
    overlappingStays: overlaps,
    guestsThatLookDuplicated: repeatedGuests.filter((g) => g.looksDuplicated),
    samePropertySameAmountNearbyDates: sameAmountNearby,
    identicalDateRangesAcrossProperties: sameDatesAcrossProperties,
    sharedConfirmationCodes: duplicateCodes,
    augustCheckoutsByProperty: augustByProperty,
    allProperties: properties.map((p) => ({
      name: p.name,
      active: p.active,
      totalReservations: p._count.reservations,
      createdAt: p.createdAt.toISOString().slice(0, 10),
    })),
    allRepeatedGuests: repeatedGuests,
  });
}
