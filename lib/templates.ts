import { formatCurrency } from "@/lib/utils";

// Message template engine: the merge fields a host can drop into a template,
// the triggers that fire it, and the renderer that fills a template with a
// real reservation's data. Inspired by Airbnb/Booking.com scheduled messages,
// which use a trigger + timing + a menu of insertable "shortcodes".

export interface MergeField {
  token: string; // what the host types, e.g. "[Full Name]"
  key: string; // stable id
  label: string;
  description: string; // shown in the field reference so the host knows what it means
  example: string; // used for the live preview
}

// Only fields backed by real structured data StayHQ holds — no invented values.
export const MERGE_FIELDS: MergeField[] = [
  { token: "[Full Name]", key: "fullName", label: "Guest full name", description: "The guest's full name from the reservation.", example: "Ana Ioana" },
  { token: "[First Name]", key: "firstName", label: "Guest first name", description: "Just the guest's first name — friendlier for greetings.", example: "Ana" },
  { token: "[Property Name]", key: "propertyName", label: "Property name", description: "The name of the booked property.", example: "Sinteu 3-Bedroom Apartment" },
  { token: "[Property Address]", key: "propertyAddress", label: "Property address", description: "The full street address of the property.", example: "Str. Principală 12, Șinteu" },
  { token: "[Check-in Date]", key: "checkInDate", label: "Check-in date", description: "The arrival date, e.g. \"Mon, Sep 7\".", example: "Mon, Sep 7, 2026" },
  { token: "[Check-out Date]", key: "checkOutDate", label: "Check-out date", description: "The departure date.", example: "Tue, Sep 8, 2026" },
  { token: "[Nights]", key: "nights", label: "Number of nights", description: "How many nights the stay lasts.", example: "1" },
  { token: "[Guests]", key: "guests", label: "Number of guests", description: "Total guests (adults + children) on the booking.", example: "2" },
  { token: "[Access Code]", key: "accessCode", label: "Door access code", description: "The active smart-lock PIN for this stay. Blank if none has been issued yet.", example: "8968" },
  { token: "[Confirmation Code]", key: "confirmationCode", label: "Booking confirmation code", description: "The reservation's confirmation / booking number.", example: "HMKW8AND9N" },
  { token: "[Channel]", key: "channel", label: "Booking channel", description: "Where the booking came from (Booking.com, Airbnb, Direct…).", example: "Booking.com" },
  { token: "[Host Name]", key: "hostName", label: "Your (host) name", description: "Your name, to sign off the message.", example: "Anton" },
  { token: "[Total]", key: "total", label: "Total amount", description: "The booking total with its currency.", example: "€649" },
  { token: "[City Tax Card Link]", key: "cityTaxCardLink", label: "City tax card-save link", description: "A link for the guest to save their card - the exact city tax amount is then charged automatically once saved. Only resolves to a real link when auto-charge is turned on for this property (Settings → City tax) and a rate is set; otherwise it's blank.", example: "https://stayhq.app/reservations/abc123?cardSaved=1" },
];

export interface TriggerDef {
  value: string;
  label: string;
  description: string; // recommendation / typical use
  usesOffset: boolean; // whether an "N days before/after" input applies
  offsetDir: "before" | "after" | null;
  anchor: "createdAt" | "checkIn" | "checkOut" | null; // date the timing is relative to
}

// Recommended triggers, ordered along the guest journey.
export const TRIGGERS: TriggerDef[] = [
  { value: "NEW_RESERVATION", label: "New booking confirmed", description: "Fires right after a guest books. Great for a warm thank-you and what happens next.", usesOffset: false, offsetDir: null, anchor: "createdAt" },
  { value: "BEFORE_CHECKIN", label: "Before check-in", description: "A set number of days before arrival. Best for directions, parking and check-in instructions.", usesOffset: true, offsetDir: "before", anchor: "checkIn" },
  { value: "CHECKIN_DAY", label: "On check-in day", description: "The morning guests arrive. Ideal for the door code, WiFi and how to get in.", usesOffset: false, offsetDir: null, anchor: "checkIn" },
  { value: "DURING_STAY", label: "During the stay", description: "A number of days after check-in. A friendly \"everything OK?\" mid-stay check.", usesOffset: true, offsetDir: "after", anchor: "checkIn" },
  { value: "BEFORE_CHECKOUT", label: "Before check-out", description: "A number of days before departure. Perfect for checkout time and instructions.", usesOffset: true, offsetDir: "before", anchor: "checkOut" },
  { value: "CHECKOUT_DAY", label: "On check-out day", description: "The morning guests leave. A last reminder of checkout steps.", usesOffset: false, offsetDir: null, anchor: "checkOut" },
  { value: "AFTER_CHECKOUT", label: "After check-out", description: "A number of days after departure. The moment to thank them and ask for a review.", usesOffset: true, offsetDir: "after", anchor: "checkOut" },
  { value: "MANUAL", label: "Manual only", description: "Never sent automatically — you send it on demand from a reservation.", usesOffset: false, offsetDir: null, anchor: null },
];

export function triggerLabel(value: string): string {
  return TRIGGERS.find((t) => t.value === value)?.label ?? value;
}

// Replace every [merge field] in the body with a value from the map (keyed by
// token). Unknown/missing values become an empty string so nothing leaks.
export function renderTemplate(body: string, values: Record<string, string>): string {
  let out = body;
  for (const f of MERGE_FIELDS) {
    out = out.split(f.token).join(values[f.token] ?? "");
  }
  return out;
}

// Sample values (keyed by token) for the live preview in the builder.
export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  MERGE_FIELDS.map((f) => [f.token, f.example])
);

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

const CHANNEL_LABELS: Record<string, string> = {
  BOOKING: "Booking.com",
  AIRBNB: "Airbnb",
  VRBO: "Vrbo",
  EXPEDIA: "Expedia",
  DIRECT: "Direct",
};

// Shape of a reservation with the relations we need to fill merge fields.
export interface TemplateReservation {
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  confirmationCode?: string | null;
  source: string;
  totalAmount?: number | null;
  currency: string;
  guest: { name: string };
  property: { name: string; address: string };
  accessCodes?: { code: string }[];
}

// Build the real merge values (keyed by token) from a reservation.
export function valuesFromReservation(res: TemplateReservation, hostName?: string | null): Record<string, string> {
  const first = res.guest.name.trim().split(/\s+/)[0] || res.guest.name;
  const nights = Math.max(1, Math.round((res.checkOut.getTime() - res.checkIn.getTime()) / 86400000));
  const total = res.totalAmount != null ? formatCurrency(res.totalAmount, res.currency) : "";
  return {
    "[Full Name]": res.guest.name,
    "[First Name]": first,
    "[Property Name]": res.property.name,
    "[Property Address]": res.property.address,
    "[Check-in Date]": fmtDate(res.checkIn),
    "[Check-out Date]": fmtDate(res.checkOut),
    "[Nights]": String(nights),
    "[Guests]": String(res.adults + res.children),
    "[Access Code]": res.accessCodes?.[0]?.code ?? "",
    "[Confirmation Code]": res.confirmationCode ?? "",
    "[Channel]": CHANNEL_LABELS[res.source] ?? res.source,
    "[Host Name]": hostName ?? "",
    "[Total]": total,
    // Filled in by the caller (see resolveCityTaxCardLinkForTemplate in
    // lib/city-tax.ts) when relevant - this is a pure, synchronous function
    // and generating a real link is an async Stripe call, so it can't
    // happen here. Left blank by default, matching "auto-charge is off."
    "[City Tax Card Link]": "",
  };
}
