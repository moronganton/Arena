import { suggestMinStay, type ImportedPlan } from "../rate-plan-import";

// Turning what Booking.com tells Channex about a listing into a rate plan
// family this app can create.
//
// The source is POST /channels/mapping_details, which returns the rooms and
// rates a channel exposes for a connection's credentials and creates nothing.
// A live Booking.com connection answers with:
//
//   { "rooms": [ { "id": 1074503007, "title": "Holiday Home", "rates": [
//       { "id": 39950621, "title": "standard rate",
//         "derived_rate_plan_ids": [39950631], "parent_rate_id": "" },
//       { "id": 39950622, "title": "non-refundable rate", "parent_rate_id": "" }
//     ] } ], "pricing_type": "Standard" }
//
// What that gives, exactly, is IDENTITY AND STRUCTURE: room types, plan names,
// channel ids, and which plans derive from which. What it does not give - and
// this is the whole reason the result below still needs a human - is any
// COMMERCIAL TERM. No percentage, no minimum stay, no cancellation policy, no
// price. Those are not withheld by Channex; they are not in what Booking.com
// sends.
//
// So this module reads the skeleton exactly and refuses to invent the rest,
// the same discipline lib/rate-plan-import.ts applies to a screenshot. The
// difference is where the uncertainty sits: a screenshot can misread a name it
// was confident about, while this cannot get a name wrong at all - it can only
// be missing numbers, and it says which.

/** A rate as the channel describes it. Every field is unknown until checked. */
interface RawRate {
  id?: unknown;
  title?: unknown;
  parent_rate_id?: unknown;
  derived_rate_plan_ids?: unknown;
  max_persons?: unknown;
}

interface RawRoom {
  id?: unknown;
  title?: unknown;
  rates?: unknown;
}

export interface ChannelPlan extends ImportedPlan {
  /** The plan's id on the channel, so the operator can match it in their extranet. */
  channelRateId: string | null;
  /**
   * True when this plan is priced against the main rate but the channel did
   * not say by how much. It is NOT a parent - it is a child missing its one
   * number, and nothing may be created until a human supplies it.
   */
  needsPercent: boolean;
}

export interface ChannelRoom {
  /** The room type's id on the channel. */
  channelRoomId: string | null;
  title: string;
  plans: ChannelPlan[];
}

export interface ChannelReadResult {
  rooms: ChannelRoom[];
  /** Blocking, and about the read as a whole rather than any one room. */
  problems: string[];
  /** Worth the operator's eye. Never blocking. */
  warnings: string[];
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Booking.com writes plan names in lower case ("standard rate"). Titles here
 * become Channex rate plan titles an operator reads every day, so they are
 * cased for a human - without touching a name that already carries its own
 * capitalisation, which would mangle a brand or an acronym.
 */
export function titleCase(raw: string): string {
  const t = raw.trim();
  if (t !== t.toLowerCase()) return t;
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Which of a room's rates is the one the others are priced against.
 *
 * Booking.com does not mark it. In the payload above BOTH plans carry an empty
 * parent_rate_id, because non-refundable is a top-level plan there rather than
 * a child of standard - Booking.com's model simply is not host24's, where
 * exactly one plan holds the price and the rest are percentages of it.
 *
 * So it is inferred, in order of how much the channel actually told us:
 *   1. a rate the channel says has derived plans hanging off it,
 *   2. a rate whose name is one operators use for their base product,
 *   3. the first, which is the order the extranet lists them in.
 */
export function pickParentIndex(rates: RawRate[]): number {
  const withChildren = rates.findIndex(
    (r) => Array.isArray(r.derived_rate_plan_ids) && r.derived_rate_plan_ids.length > 0
  );
  if (withChildren >= 0) return withChildren;

  const named = rates.findIndex((r) => {
    const t = asString(r.title)?.toLowerCase() ?? "";
    return /\b(standard|flexible|base|basic|default)\b/.test(t);
  });
  if (named >= 0) return named;

  return rates.length > 0 ? 0 : -1;
}

function readRoom(raw: RawRoom, warnings: string[]): ChannelRoom | null {
  const title = asString(raw.title);
  const channelRoomId = asString(raw.id);
  const rawRates = Array.isArray(raw.rates) ? (raw.rates as RawRate[]) : [];

  // A room the channel exposes with no sellable rate is real - a room type set
  // up in the extranet and never given a plan - and it is not an error. It
  // just cannot be imported, so it is reported rather than silently dropped.
  if (rawRates.length === 0) {
    warnings.push(`"${title ?? "Untitled room"}" has no rate plans on the channel, so there is nothing to import from it.`);
    return null;
  }

  // The same rate can appear under more than one room (a "standard rate" sold
  // for both a Holiday Home and a Studio), and within one room a repeat is a
  // duplicate rather than two products.
  const seen = new Set<string>();
  const rates: RawRate[] = [];
  for (const r of rawRates) {
    const id = asString(r.id);
    const key = id ?? `title:${asString(r.title)?.toLowerCase() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rates.push(r);
  }

  const parentIndex = pickParentIndex(rates);
  const plans: ChannelPlan[] = [];
  const usedTitles = new Set<string>();

  rates.forEach((r, i) => {
    const rawTitle = asString(r.title);
    if (!rawTitle) {
      warnings.push("A rate plan on the channel had no name and was skipped.");
      return;
    }
    let title = titleCase(rawTitle);

    // Channex refuses duplicate titles on a property, so a collision has to be
    // resolved here rather than surfacing as a 422 halfway through creating.
    if (usedTitles.has(title.toLowerCase())) {
      const channelId = asString(r.id);
      const suffixed = channelId ? `${title} (${channelId})` : `${title} (2)`;
      warnings.push(`Two plans on the channel are both called "${title}". The second was renamed "${suffixed}".`);
      title = suffixed;
    }
    usedTitles.add(title.toLowerCase());

    const isParent = i === parentIndex;
    // Never read from this endpoint - so never claimed as read.
    const suggestion = suggestMinStay(title);

    plans.push({
      title,
      derivedPercent: null,
      minStayArrival: suggestion.minStay,
      cancellationPolicy: null,
      minStayWasRead: false,
      channelRateId: asString(r.id),
      needsPercent: !isParent,
    });
  });

  // The parent must come first: nothing can derive from a plan that does not
  // exist yet, and this array is also the provisioning order.
  const at = plans.findIndex((p) => !p.needsPercent);
  if (at > 0) plans.unshift(...plans.splice(at, 1));

  if (plans.length === 0) return null;

  return { channelRoomId, title: title ?? "Room", plans };
}

/**
 * Read a mapping_details payload into rooms of proposed plans.
 *
 * Returns rooms rather than one flat family on purpose. A Booking.com listing
 * routinely carries several room types, host24 currently maps one, and quietly
 * importing the first would misrepresent the listing to the person who has to
 * trust it.
 */
export function readChannelRatePlans(payload: unknown): ChannelReadResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  const rawRooms =
    payload && typeof payload === "object" && Array.isArray((payload as { rooms?: unknown }).rooms)
      ? ((payload as { rooms: unknown[] }).rooms as RawRoom[])
      : null;

  if (!rawRooms) {
    return {
      rooms: [],
      problems: ["The channel didn't return any rooms. Check the connection is mapped in Channex."],
      warnings,
    };
  }

  const rooms = rawRooms.map((r) => readRoom(r, warnings)).filter((r): r is ChannelRoom => r !== null);

  if (rooms.length === 0) {
    problems.push("The channel returned rooms, but none of them has a rate plan host24 can import.");
    return { rooms, problems, warnings };
  }

  // Booking.com names derived plans it does not then describe. Left unsaid,
  // an operator would count the plans on this screen, count more in their
  // extranet, and have no way to know which of the two was lying.
  const known = new Set<string>();
  for (const room of rooms) for (const p of room.plans) if (p.channelRateId) known.add(p.channelRateId);
  const missing = new Set<string>();
  for (const raw of rawRooms) {
    const rates = Array.isArray(raw.rates) ? (raw.rates as RawRate[]) : [];
    for (const r of rates) {
      const ids = Array.isArray(r.derived_rate_plan_ids) ? r.derived_rate_plan_ids : [];
      for (const id of ids) {
        const s = asString(id);
        if (s && !known.has(s)) missing.add(s);
      }
    }
  }
  if (missing.size > 0) {
    warnings.push(
      `The channel mentions ${missing.size} derived rate plan${missing.size === 1 ? "" : "s"} ` +
        `(${[...missing].join(", ")}) that it doesn't describe, so ${missing.size === 1 ? "it isn't" : "they aren't"} ` +
        `in this list. Add ${missing.size === 1 ? "it" : "them"} by hand if you sell ${missing.size === 1 ? "it" : "them"}.`
    );
  }

  if (rooms.length > 1) {
    warnings.push(
      `This listing has ${rooms.length} room types on the channel. host24 manages one room type per property, ` +
        `so pick the one this property is, and set the others up as their own properties.`
    );
  }

  return { rooms, problems, warnings };
}

/**
 * The adapter code Channex uses, written the way the operator's extranet
 * writes it. Unknown codes are returned as-is rather than mangled: a channel
 * this app has never seen is better shown by its real name than by a guess.
 */
export function channelDisplayName(code: string): string {
  const known: Record<string, string> = {
    bookingcom: "Booking.com",
    airbnb: "Airbnb",
    expedia: "Expedia",
    agoda: "Agoda",
    vrbo: "Vrbo",
    hostelworld: "Hostelworld",
    despegar: "Despegar",

  };
  return known[code.trim().toLowerCase()] ?? code.trim();
}
