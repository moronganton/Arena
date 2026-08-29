import { derivedPriceFor } from "./rate-plan-spec";

// What a guest actually sees, per channel, for a stay of N nights.
//
// The rate plan list answers "what products exist"; it does not answer "what
// price is displayed where", and those are different questions for two
// reasons that compound:
//
//   1. The two channels sell different sets. Booking.com takes the whole
//      family; Airbnb accepts exactly ONE rate plan per listing, which
//      Channex creates as a 0% mirror of the parent. So five of six products
//      are Booking.com-only - verified live on this property, where the
//      Airbnb channel plan mirrors the parent at 0% with the parent's floor.
//   2. Within a channel, an OTA only offers the plans whose minimum stay the
//      guest satisfies, cheapest first. A one-night guest and a seven-night
//      guest are quoted different products at different prices from the same
//      unchanged family.
//
// Pure, so the panel that renders this cannot drift from the rule that
// decides it, and so both can be tested without a database or a channel.

export interface PlanLike {
  title: string;
  kind: string; // PARENT | DERIVED
  derivedPercent: number | null;
  minStayArrival: number;
}

export type ChannelKey = "BOOKING" | "AIRBNB";

export interface Offer {
  title: string;
  price: number;
  minStay: number;
  derivedPercent: number | null;
}

export interface ChannelQuote {
  channel: ChannelKey;
  offers: Offer[]; // qualifying for this stay, cheapest first
  cheapest: Offer | null;
  bookable: boolean;
  /** The shortest stay this channel can sell at all, across every plan it carries. */
  shortestStay: number | null;
}

/**
 * The plans a channel carries. Airbnb takes one rate plan per listing - the
 * parent's mirror - so everything derived is Booking.com-only.
 */
export function plansOnChannel(plans: PlanLike[], channel: ChannelKey): PlanLike[] {
  const active = plans.filter((p) => p.minStayArrival > 0);
  return channel === "AIRBNB" ? active.filter((p) => p.kind === "PARENT") : active;
}

/**
 * The stay lengths where the answer actually changes: one night, plus every
 * distinct minimum in the family. Derived rather than hardcoded, so a
 * property that sells a 5-night product gets a 5-night row without anyone
 * editing a list.
 */
export function ladderLengths(plans: PlanLike[]): number[] {
  const lengths = new Set<number>([1]);
  for (const p of plans) if (p.minStayArrival > 0) lengths.add(p.minStayArrival);
  return [...lengths].sort((a, b) => a - b);
}

export function offersForStay(
  plans: PlanLike[],
  parentPrice: number,
  nights: number,
  channel: ChannelKey
): ChannelQuote {
  const carried = plansOnChannel(plans, channel);
  const offers = carried
    .filter((p) => p.minStayArrival <= nights)
    .map((p) => ({
      title: p.title,
      // The parent has no percentage of its own; Airbnb's mirror is the
      // parent at 0%, so both resolve through the same call.
      price: derivedPriceFor(parentPrice, p.kind === "PARENT" ? null : p.derivedPercent),
      minStay: p.minStayArrival,
      derivedPercent: p.kind === "PARENT" ? null : p.derivedPercent,
    }))
    // Cheapest first, then by name so equal prices order predictably rather
    // than by whatever the database returned.
    .sort((a, b) => a.price - b.price || a.title.localeCompare(b.title));

  const floors = carried.map((p) => p.minStayArrival);
  return {
    channel,
    offers,
    cheapest: offers[0] ?? null,
    bookable: offers.length > 0,
    shortestStay: floors.length ? Math.min(...floors) : null,
  };
}

// --- which channels actually serve this property -------------------------
//
// Channex reports connections account-wide, each carrying the property ids it
// covers, so "is Airbnb connected" is only answerable per property by looking
// inside that list. Reported as codes rather than the raw label because the
// /channels payload names a channel "AirBNB" while the documented code is
// ABB, and both appear depending on the endpoint.

// Channex is not consistent about this: GET /channels answers JSON:API-shaped,
// with every field under `attributes`, while other endpoints answer flat. Read
// as flat only, `properties` came back undefined for every row, no row ever
// matched, and this function returned "no channels connected" for every
// property on the account - a confident, wrong answer that the panel above it
// renders differently from "couldn't check".
export interface ChannelConnectionLike {
  channel?: string | null;
  is_active?: boolean | null;
  properties?: string[] | null;
  attributes?: {
    channel?: string | null;
    is_active?: boolean | null;
    properties?: string[] | null;
  } | null;
}

function unwrap(c: ChannelConnectionLike): {
  channel?: string | null;
  is_active?: boolean | null;
  properties?: string[] | null;
} {
  return c.attributes ?? c;
}

function normalizeChannel(raw: string): ChannelKey | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "abb" || s.includes("airbnb")) return "AIRBNB";
  if (s === "bdc" || s.includes("booking")) return "BOOKING";
  return null;
}

export function connectedChannels(
  connections: ChannelConnectionLike[],
  channexPropertyId: string
): ChannelKey[] {
  const found = new Set<ChannelKey>();
  for (const row of connections) {
    const c = unwrap(row);
    if (c.is_active === false) continue;
    if (!c.properties?.includes(channexPropertyId)) continue;
    const key = c.channel ? normalizeChannel(c.channel) : null;
    if (key) found.add(key);
  }
  return [...found];
}
