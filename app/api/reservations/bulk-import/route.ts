import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Bulk-imports historical reservations from pasted CSV, for backfilling
// financial analytics on stays that predate the Smoobu connection or fell
// outside its sync window (syncSmoobuBookings only ever looks 90 days back).
//
// Column aliases below were verified against a REAL Booking.com Extranet
// export ("Checkin_*.xls" reservation list), not guessed - see "Status" and
// "guestnames" in particular, which do not look anything like the generic
// names a hand-built CSV would use.
//
// Two modes on the same endpoint, sharing one parser/validator so preview and
// commit can never see the data differently:
//   POST { csv, mode: "preview" }                        -> validate only, no writes
//   POST { csv, mode: "commit", excludeRows?: number[] }  -> create the valid,
//                                                            non-excluded rows
//
// Deliberately does NOT call autoGenerateCodesForReservation, does NOT send
// any guest message, and does NOT call notifyUser. A historical stay that
// ended months ago should not get a fresh door PIN or trigger a "new
// reservation" alert to the host - this endpoint only ever writes a
// Reservation + (if needed) a Guest row, nothing else.

const SOURCE_ALIASES: Record<string, string> = {
  booking: "BOOKING", bookingcom: "BOOKING",
  airbnb: "AIRBNB",
  vrbo: "VRBO", homeaway: "VRBO",
  expedia: "EXPEDIA",
  direct: "DIRECT",
};

// "ok" and "cancelledbyguest" are Booking.com's OWN status vocabulary,
// confirmed from a real export (69 rows: 59 "ok", 10 "cancelled_by_guest").
// "cancelledbyhotel" and "noshow" are Booking.com's known equivalents for the
// other two cases, added defensively - not seen in the sample file, but the
// same export format is documented to use them.
//
// "ok" maps to CONFIRMED rather than trying to guess CHECKED_OUT from the
// date: /api/finance/report recognises revenue by checkOut date for any
// status that is not CANCELLED/NO_SHOW, so CONFIRMED vs CHECKED_OUT makes no
// difference to the numbers, and guessing wrong would be pointless risk.
const STATUS_ALIASES: Record<string, string> = {
  pending: "PENDING",
  confirmed: "CONFIRMED",
  ok: "CONFIRMED",
  checkedin: "CHECKED_IN",
  checkedout: "CHECKED_OUT",
  cancelled: "CANCELLED", canceled: "CANCELLED",
  cancelledbyguest: "CANCELLED", cancelledbyhotel: "CANCELLED",
  noshow: "NO_SHOW",
};

// Header aliases -> canonical field name. Keys are the header text with every
// non-alphanumeric character stripped and lowercased, so "Total Amount",
// "total_amount", "Guest name(s)" and "Check-in" all resolve correctly -
// hosts pasting a spreadsheet export should not have to match an exact
// schema, and OTA exports are not written for that purpose anyway.
const HEADER_ALIASES: Record<string, string> = {
  property: "property", propertyname: "property",
  checkin: "checkIn", arrival: "checkIn", arrivaldate: "checkIn",
  checkout: "checkOut", departure: "checkOut", departuredate: "checkOut",
  guestname: "guestName", guestnames: "guestName", guest: "guestName", name: "guestName",
  guestemail: "guestEmail", email: "guestEmail",
  guestphone: "guestPhone", phone: "guestPhone", phonenumber: "guestPhone",
  totalamount: "totalAmount", amount: "totalAmount", total: "totalAmount", price: "totalAmount",
  currency: "currency",
  source: "source", channel: "source",
  status: "status",
  confirmationcode: "confirmationCode", confirmation: "confirmationCode",
  bookingid: "confirmationCode", booknumber: "confirmationCode", reservationid: "confirmationCode", code: "confirmationCode",
  adults: "adults",
  children: "children",
  // "Persons" is deliberately NOT aliased to adults. Booking.com's own export
  // has both a Persons column (total party size) and a separate Adults
  // column - mapping both to the same field meant whichever came later in
  // the header row silently won, with no warning. Adults + Children already
  // gives the precise breakdown when both are present; Persons alone (total
  // only) is not a substitute worth guessing at.
  remarks: "specialRequests", specialrequests: "specialRequests",
  notes: "notes", internalnotes: "notes", note: "notes",
  bookedon: "bookedOn",
  // Observability field only, same as the live-sync capture in
  // lib/channels/smoobu.ts - /api/finance/report never reads this, it keeps
  // using PlatformFeeSetting. Historical Booking.com exports have this
  // populated on confirmed rows (blank on cancelled ones, correctly - no
  // commission is charged on a booking that never completed).
  commissionamount: "platformCommission", commission: "platformCommission",
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Minimal RFC4180-ish CSV parser: comma-separated, "..." quoting with ""
// for an escaped quote inside a field. No external dependency needed for
// what a spreadsheet export actually produces.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Splits a combined "153 EUR" / "1,240.50 USD" cell into amount + currency.
// Booking.com's own export has no separate currency column - it is folded
// into Price - so this is required to read that format at all, not just a
// convenience. Falls back to treating the whole string as a bare number when
// there is no trailing currency code (a plain "153" from a hand-built CSV).
function parseAmount(raw: string): { amount: number | null; currency: string | null } {
  const trimmed = raw.trim();
  const m = /^([\d.,\-]+)\s*([A-Za-z]{3})?$/.exec(trimmed);
  if (!m) return { amount: null, currency: null };
  const n = Number(m[1].replace(/,/g, ""));
  return { amount: Number.isNaN(n) ? null : n, currency: m[2] ? m[2].toUpperCase() : null };
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface ParsedRow {
  index: number;
  raw: Record<string, string>;
  errors: string[];
  propertyId?: string;
  propertyName?: string;
  checkIn?: Date;
  checkOut?: Date;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  totalAmount?: number;
  currency?: string;
  source?: string;
  status?: string;
  confirmationCode?: string;
  adults?: number;
  children?: number;
  specialRequests?: string;
  notes?: string;
  bookedOn?: Date;
  platformCommission?: number;
  duplicate?: { reason: string; existingReservationId?: string };
  liveWindowWarning?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const csv = typeof body.csv === "string" ? body.csv : "";
  const mode = body.mode === "commit" ? "commit" : "preview";
  const excludeRows = new Set<number>(Array.isArray(body.excludeRows) ? body.excludeRows : []);
  // A whole export file comes from one platform's own extranet (Booking.com,
  // Airbnb, ...) — it has no per-row "source" column because the file itself
  // implies it. This is the fallback for rows without an explicit source;
  // defaults to Booking.com since that's what a raw extranet export is.
  const defaultSource = typeof body.defaultSource === "string" && SOURCE_ALIASES[normKey(body.defaultSource)]
    ? SOURCE_ALIASES[normKey(body.defaultSource)]
    : "BOOKING";

  if (!csv.trim()) return NextResponse.json({ error: "Paste or upload CSV data first." }, { status: 400 });

  const table = parseCsv(csv);
  if (table.length < 2) {
    return NextResponse.json({ error: "Need a header row plus at least one data row." }, { status: 400 });
  }

  const headerRow = table[0];
  const fieldByCol: (string | null)[] = headerRow.map((h) => HEADER_ALIASES[normKey(h)] || null);
  if (!fieldByCol.includes("property") || !fieldByCol.includes("checkIn") || !fieldByCol.includes("checkOut")) {
    return NextResponse.json({
      error: 'The header row must include "property", "checkIn" and "checkOut" columns (any recognisable spelling of them).',
    }, { status: 400 });
  }

  const properties = await prisma.property.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, currency: true },
  });

  function resolveProperty(name: string): { id: string; currency: string } | { error: string } {
    const target = name.trim().toLowerCase();
    if (!target) return { error: "Property name is blank." };
    const exact = properties.find((p) => p.name.toLowerCase() === target);
    if (exact) return { id: exact.id, currency: exact.currency };
    const contains = properties.filter(
      (p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase())
    );
    if (contains.length === 1) return { id: contains[0].id, currency: contains[0].currency };
    if (contains.length > 1) return { error: `"${name}" matches ${contains.length} properties - use the exact name.` };
    return { error: `No property named "${name}".` };
  }

  const liveWindowCutoff = new Date(Date.now() - NINETY_DAYS_MS);

  const rows: ParsedRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const raw: Record<string, string> = {};
    table[r].forEach((val, c) => { if (fieldByCol[c]) raw[fieldByCol[c]!] = val.trim(); });
    const parsed: ParsedRow = { index: r, raw, errors: [] };

    const propResult = resolveProperty(raw.property || "");
    if ("error" in propResult) {
      parsed.errors.push(propResult.error);
    } else {
      parsed.propertyId = propResult.id;
      parsed.propertyName = raw.property;
      parsed.currency = propResult.currency;
    }

    const checkIn = raw.checkIn ? new Date(raw.checkIn) : null;
    const checkOut = raw.checkOut ? new Date(raw.checkOut) : null;
    if (!checkIn || Number.isNaN(checkIn.getTime())) parsed.errors.push(`Invalid checkIn date "${raw.checkIn || ""}" - use YYYY-MM-DD.`);
    else parsed.checkIn = checkIn;
    if (!checkOut || Number.isNaN(checkOut.getTime())) parsed.errors.push(`Invalid checkOut date "${raw.checkOut || ""}" - use YYYY-MM-DD.`);
    else parsed.checkOut = checkOut;
    if (parsed.checkIn && parsed.checkOut && parsed.checkOut <= parsed.checkIn) {
      parsed.errors.push("checkOut must be after checkIn.");
    }

    // A check-in inside Smoobu's own rolling sync window is very likely
    // already in StayHQ (or belongs there via the live pipeline, which also
    // generates the door PIN and sends guest messages - this endpoint does
    // neither). The duplicate check below already catches an exact match;
    // this is a softer, non-blocking heads-up for rows that are recent/
    // upcoming but did NOT match anything already on file.
    if (parsed.checkIn && parsed.checkIn >= liveWindowCutoff) {
      parsed.liveWindowWarning = "Check-in is within Smoobu's live sync range (last 90 days or later) - confirm this isn't already in StayHQ before importing.";
    }

    parsed.guestName = raw.guestName || "Guest";
    parsed.guestEmail = raw.guestEmail || undefined;
    parsed.guestPhone = raw.guestPhone || undefined;

    if (raw.totalAmount) {
      const { amount, currency } = parseAmount(raw.totalAmount);
      if (amount == null || amount < 0) parsed.errors.push(`Invalid totalAmount "${raw.totalAmount}".`);
      else {
        parsed.totalAmount = amount;
        // An explicit "currency" column always wins; a currency code folded
        // into the amount cell (Booking.com's "153 EUR") is the fallback.
        if (currency && !raw.currency) parsed.currency = currency;
      }
    }
    if (raw.currency) parsed.currency = raw.currency.trim().toUpperCase();

    if (raw.source) {
      const src = SOURCE_ALIASES[normKey(raw.source)];
      if (!src) parsed.errors.push(`Unknown source "${raw.source}" - use Booking.com, Airbnb, VRBO, Expedia or Direct.`);
      else parsed.source = src;
    } else {
      parsed.source = defaultSource;
    }

    if (raw.status) {
      const st = STATUS_ALIASES[normKey(raw.status)];
      if (!st) parsed.errors.push(`Unknown status "${raw.status}".`);
      else parsed.status = st;
    } else {
      parsed.status = "CONFIRMED";
    }

    if (raw.adults) {
      const n = Math.trunc(Number(raw.adults));
      if (!Number.isNaN(n) && n > 0) parsed.adults = n;
    }
    if (raw.children) {
      const n = Math.trunc(Number(raw.children));
      if (!Number.isNaN(n) && n >= 0) parsed.children = n;
    }

    parsed.confirmationCode = raw.confirmationCode || undefined;
    parsed.specialRequests = raw.specialRequests || undefined;
    parsed.notes = raw.notes || undefined;

    if (raw.bookedOn) {
      const d = new Date(raw.bookedOn);
      if (!Number.isNaN(d.getTime())) parsed.bookedOn = d;
    }

    // Observational only - a malformed value here just leaves it unset
    // rather than failing the whole row, unlike totalAmount.
    if (raw.platformCommission) {
      const { amount } = parseAmount(raw.platformCommission);
      if (amount != null) parsed.platformCommission = amount;
    }

    rows.push(parsed);
  }

  // Duplicate detection, two tiers.
  //
  // Tier 1 - confirmation code (the OTA's real booking number). Authoritative
  // regardless of status: the same Book Number appearing twice always means
  // "this is the same reservation", cancelled or not.
  //
  // Tier 2 - property + identical checkIn + checkOut, used only when no
  // confirmation code is available to compare. This one is status-sensitive
  // on purpose: a CANCELLED reservation frees the unit back up, so a
  // cancellation and a later, unrelated booking legitimately share the same
  // dates - confirmed against this exact export, which has four such pairs
  // (a cancellation immediately followed by a different guest booking the
  // freed dates). Only two ACTIVE (non-cancelled, non-no-show) reservations
  // on the same dates at the same property are a real collision - this app
  // has no multi-unit-per-property concept, so that would be an actual
  // double-booking, not a coincidence.
  const involvedPropertyIds = [...new Set(rows.map((r) => r.propertyId).filter(Boolean))] as string[];
  const existing = involvedPropertyIds.length
    ? await prisma.reservation.findMany({
        where: { propertyId: { in: involvedPropertyIds } },
        select: { id: true, propertyId: true, checkIn: true, checkOut: true, status: true, confirmationCode: true },
      })
    : [];
  const isActive = (status: string | undefined) => status !== "CANCELLED" && status !== "NO_SHOW";

  const codeKey = (propertyId: string, code: string) => `${propertyId}|${code.trim().toLowerCase()}`;
  const existingByCode = new Map(
    existing.filter((e) => e.confirmationCode).map((e) => [codeKey(e.propertyId, e.confirmationCode!), e.id])
  );

  const dateKey = (propertyId: string, checkIn: Date, checkOut: Date) =>
    `${propertyId}|${checkIn.toISOString()}|${checkOut.toISOString()}`;
  const existingByDateActive = new Map(
    existing
      .filter((e) => isActive(e.status))
      .map((e) => [dateKey(e.propertyId, e.checkIn, e.checkOut), e.id])
  );

  const seenCodeInBatch = new Map<string, number>();
  const seenDateInBatch = new Map<string, number>(); // only tracks ACTIVE rows

  for (const row of rows) {
    if (!row.propertyId || !row.checkIn || !row.checkOut) continue;

    // Tier 1: confirmation code match - conclusive WHEN it hits, but a miss
    // proves nothing on its own. A live-synced reservation stores Smoobu's
    // own internal booking id as its confirmationCode (e.g. "149927776"),
    // not the OTA's Book Number/reference-id this CSV carries (e.g.
    // "5544519195" for that exact same reservation, confirmed against a real
    // account) - the two numbering schemes never intersect, so a row can
    // fail this check and still be an exact duplicate of something already
    // live-synced. This tier stays useful for catching the SAME csv (or a
    // previous bulk import using the same numbering) re-run twice.
    if (row.confirmationCode) {
      const ck = codeKey(row.propertyId, row.confirmationCode);
      const dbHit = existingByCode.get(ck);
      if (dbHit) {
        row.duplicate = { reason: `A reservation with confirmation code ${row.confirmationCode} already exists in StayHQ.`, existingReservationId: dbHit };
        continue;
      }
      const firstRow = seenCodeInBatch.get(ck);
      if (firstRow !== undefined) {
        row.duplicate = { reason: `Same confirmation code as row ${firstRow} in this file.` };
        continue;
      }
      seenCodeInBatch.set(ck, row.index);
      // Falls through to the date check below on purpose - see comment above.
    }

    if (!isActive(row.status)) continue; // a cancelled/no-show row never collides on dates alone

    const dk = dateKey(row.propertyId, row.checkIn, row.checkOut);
    const dbHit = existingByDateActive.get(dk);
    if (dbHit) {
      row.duplicate = { reason: "A reservation already exists in StayHQ for these exact dates.", existingReservationId: dbHit };
      continue;
    }
    const firstRow = seenDateInBatch.get(dk);
    if (firstRow !== undefined) {
      row.duplicate = { reason: `Same property and dates as row ${firstRow} in this file.` };
    } else {
      seenDateInBatch.set(dk, row.index);
    }
  }

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.errors.length === 0 && !r.duplicate).length,
    duplicates: rows.filter((r) => r.errors.length === 0 && r.duplicate).length,
    errors: rows.filter((r) => r.errors.length > 0).length,
    liveWindowWarnings: rows.filter((r) => r.errors.length === 0 && !r.duplicate && r.liveWindowWarning).length,
  };

  if (mode === "preview") {
    return NextResponse.json({
      summary,
      rows: rows.map((r) => ({
        index: r.index,
        property: r.propertyName,
        checkIn: r.checkIn?.toISOString().slice(0, 10),
        checkOut: r.checkOut?.toISOString().slice(0, 10),
        guestName: r.guestName,
        totalAmount: r.totalAmount,
        currency: r.currency,
        source: r.source,
        status: r.status,
        confirmationCode: r.confirmationCode,
        errors: r.errors,
        duplicate: r.duplicate?.reason || null,
        liveWindowWarning: r.liveWindowWarning || null,
      })),
    });
  }

  // commit — only rows with zero validation errors, not excluded, and (if
  // duplicate-suspected) explicitly re-included by the host via excludeRows
  // NOT containing them... inverse: excludeRows lists rows the host does NOT
  // want imported, which by default is every duplicate the client pre-checks.
  let created = 0;
  let skipped = 0;
  const createdIds: string[] = [];

  for (const row of rows) {
    if (row.errors.length > 0 || excludeRows.has(row.index) || !row.propertyId || !row.checkIn || !row.checkOut) {
      skipped++;
      continue;
    }

    let guest = row.guestEmail
      ? await prisma.guest.findFirst({ where: { email: row.guestEmail } })
      : null;
    if (!guest) {
      guest = await prisma.guest.create({
        data: { name: row.guestName || "Guest", email: row.guestEmail, phone: row.guestPhone },
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        propertyId: row.propertyId,
        guestId: guest.id,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        ...(row.adults != null ? { adults: row.adults } : {}),
        ...(row.children != null ? { children: row.children } : {}),
        totalAmount: row.totalAmount,
        currency: row.currency || "EUR",
        source: row.source || "DIRECT",
        status: row.status || "CONFIRMED",
        // "manual-" never collides with the "smoobu-" scheme the live sync
        // uses, so this can never silently merge with (or be silently
        // overwritten by) an actual Smoobu-synced booking.
        externalId: row.confirmationCode ? `manual-${row.confirmationCode}` : undefined,
        confirmationCode: row.confirmationCode,
        specialRequests: row.specialRequests,
        internalNotes: row.notes ? `Bulk-imported: ${row.notes}` : "Bulk-imported historical reservation",
        // Preserves the OTA's real booking-creation timestamp when the source
        // export has one, rather than stamping every backfilled row with
        // "just now" - Prisma allows overriding a @default(now()) field with
        // an explicit value.
        ...(row.bookedOn ? { createdAt: row.bookedOn } : {}),
        // No platformCommissionSeenAt here on purpose - "delay until Smoobu
        // reveals it" doesn't apply to historical data we already know at
        // import time, only to reservations still flowing through live sync.
        ...(row.platformCommission != null ? { platformCommission: row.platformCommission } : {}),
      },
    });
    createdIds.push(reservation.id);
    created++;
  }

  return NextResponse.json({ created, skipped, createdIds });
}
