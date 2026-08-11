import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Bulk-imports historical reservations from pasted CSV, for backfilling
// financial analytics on stays that predate the Smoobu connection or fell
// outside its sync window (syncSmoobuBookings only ever looks 90 days back).
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
const STATUS_ALIASES: Record<string, string> = {
  pending: "PENDING",
  confirmed: "CONFIRMED",
  checkedin: "CHECKED_IN",
  checkedout: "CHECKED_OUT",
  cancelled: "CANCELLED", canceled: "CANCELLED",
  noshow: "NO_SHOW",
};
// Header aliases -> canonical field name. Keys are the header text with
// spaces/underscores/dots stripped and lowercased, so "Total Amount",
// "total_amount" and "totalAmount" all resolve the same way - hosts preparing
// this in Excel or Sheets should not have to match an exact schema.
const HEADER_ALIASES: Record<string, string> = {
  property: "property", propertyname: "property",
  checkin: "checkIn", arrival: "checkIn", arrivaldate: "checkIn",
  checkout: "checkOut", departure: "checkOut", departuredate: "checkOut",
  guestname: "guestName", guest: "guestName", name: "guestName",
  guestemail: "guestEmail", email: "guestEmail",
  totalamount: "totalAmount", amount: "totalAmount", total: "totalAmount", price: "totalAmount",
  currency: "currency",
  source: "source", channel: "source",
  status: "status",
  confirmationcode: "confirmationCode", confirmation: "confirmationCode",
  bookingid: "confirmationCode", reservationid: "confirmationCode", code: "confirmationCode",
  notes: "notes", internalnotes: "notes", note: "notes",
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_.\-]/g, "");
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
  totalAmount?: number;
  currency?: string;
  source?: string;
  status?: string;
  confirmationCode?: string;
  notes?: string;
  duplicate?: { reason: string; existingReservationId?: string };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const csv = typeof body.csv === "string" ? body.csv : "";
  const mode = body.mode === "commit" ? "commit" : "preview";
  const excludeRows = new Set<number>(Array.isArray(body.excludeRows) ? body.excludeRows : []);

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

    parsed.guestName = raw.guestName || "Guest";
    parsed.guestEmail = raw.guestEmail || undefined;

    if (raw.totalAmount) {
      const n = Number(raw.totalAmount.replace(/[^\d.-]/g, ""));
      if (Number.isNaN(n) || n < 0) parsed.errors.push(`Invalid totalAmount "${raw.totalAmount}".`);
      else parsed.totalAmount = n;
    }
    if (raw.currency) parsed.currency = raw.currency.trim().toUpperCase();

    if (raw.source) {
      const src = SOURCE_ALIASES[normKey(raw.source)];
      if (!src) parsed.errors.push(`Unknown source "${raw.source}" - use Booking.com, Airbnb, VRBO, Expedia or Direct.`);
      else parsed.source = src;
    } else {
      parsed.source = "DIRECT";
    }

    if (raw.status) {
      const st = STATUS_ALIASES[normKey(raw.status)];
      if (!st) parsed.errors.push(`Unknown status "${raw.status}".`);
      else parsed.status = st;
    } else {
      parsed.status = "CONFIRMED";
    }

    parsed.confirmationCode = raw.confirmationCode || undefined;
    parsed.notes = raw.notes || undefined;

    rows.push(parsed);
  }

  // Duplicate detection: within this batch, and against reservations already
  // in the database for the properties involved. Same property + identical
  // checkIn + checkOut is treated as a duplicate signal - this app has no
  // multi-unit-per-property concept, so two genuinely different bookings at
  // one property sharing the exact same pair of dates would itself be a
  // double-booking, not a coincidence.
  const involvedPropertyIds = [...new Set(rows.map((r) => r.propertyId).filter(Boolean))] as string[];
  const existing = involvedPropertyIds.length
    ? await prisma.reservation.findMany({
        where: { propertyId: { in: involvedPropertyIds } },
        select: { id: true, propertyId: true, checkIn: true, checkOut: true },
      })
    : [];
  const existingKey = (propertyId: string, checkIn: Date, checkOut: Date) =>
    `${propertyId}|${checkIn.toISOString()}|${checkOut.toISOString()}`;
  const existingMap = new Map(existing.map((e) => [existingKey(e.propertyId, e.checkIn, e.checkOut), e.id]));

  const seenInBatch = new Map<string, number>(); // key -> first row index
  for (const row of rows) {
    if (!row.propertyId || !row.checkIn || !row.checkOut) continue;
    const key = existingKey(row.propertyId, row.checkIn, row.checkOut);
    const dbHit = existingMap.get(key);
    if (dbHit) {
      row.duplicate = { reason: "A reservation already exists in StayHQ for these exact dates.", existingReservationId: dbHit };
      continue;
    }
    const firstRow = seenInBatch.get(key);
    if (firstRow !== undefined) {
      row.duplicate = { reason: `Same property and dates as row ${firstRow} in this file.` };
    } else {
      seenInBatch.set(key, row.index);
    }
  }

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.errors.length === 0 && !r.duplicate).length,
    duplicates: rows.filter((r) => r.errors.length === 0 && r.duplicate).length,
    errors: rows.filter((r) => r.errors.length > 0).length,
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
        data: { name: row.guestName || "Guest", email: row.guestEmail },
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        propertyId: row.propertyId,
        guestId: guest.id,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        totalAmount: row.totalAmount,
        currency: row.currency || "EUR",
        source: row.source || "DIRECT",
        status: row.status || "CONFIRMED",
        // "manual-" never collides with the "smoobu-" scheme the live sync
        // uses, so this can never silently merge with (or be silently
        // overwritten by) an actual Smoobu-synced booking.
        externalId: row.confirmationCode ? `manual-${row.confirmationCode}` : undefined,
        confirmationCode: row.confirmationCode,
        internalNotes: row.notes ? `Bulk-imported: ${row.notes}` : "Bulk-imported historical reservation",
      },
    });
    createdIds.push(reservation.id);
    created++;
  }

  return NextResponse.json({ created, skipped, createdIds });
}
