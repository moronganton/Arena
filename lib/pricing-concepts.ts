// The four things an operator actually decides about price, and how they map
// onto the single generic PricingRule row underneath.
//
// The engine was never the problem. What the operator saw was: Rule Name,
// Rule Type (a five-option dropdown the materializer never reads), start and
// end dates, day-of-week chips, price OR adjustment OR percentage, min nights,
// and a raw Priority integer with helper text explaining the seeded values.
// Nobody running a flat thinks "a priority-20 percentage adjustment scoped to
// days 5 and 6"; they think "weekends cost more".
//
// Every competitor in this segment ships named concepts instead - Smoobu has a
// weekend price field, Lodgify has Season objects with a weekday/weekend split,
// Hostaway does date-range bulk edits with a day-of-week filter. None of them
// exposes a generic rule. This module is that vocabulary: four concepts, each
// pinned to a fixed priority so the operator never sees or sets one.

export const PRIORITY = {
  /** The floor. One per property, no dates, applies to every night. */
  BASE: 0,
  /** A named date range. Beats the base. */
  SEASON: 10,
  /** Day-of-week uplift. Beats a season, so a weekend inside summer is dearer. */
  WEEKEND: 20,
  /** Set by clicking dates on the calendar. Beats everything. */
  OVERRIDE: 50,
} as const;

export const MANUAL_PREFIX = "[manual]";
export const WEEKEND_DAYS = [5, 6]; // Fri, Sat - getUTCDay numbering

export type Concept = "BASE" | "SEASON" | "WEEKEND" | "OVERRIDE" | "CUSTOM";

export interface RuleLike {
  name: string;
  startDate: string | Date | null;
  endDate: string | Date | null;
  daysOfWeek: string | null; // JSON array
  price: number | null;
  adjustment: number | null;
  priority: number;
}

export function parseDays(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const days = JSON.parse(raw);
    return Array.isArray(days) && days.every((d) => typeof d === "number") ? days : null;
  } catch {
    return null;
  }
}

/**
 * Which of the four concepts an existing rule belongs to.
 *
 * Classification is by SHAPE, not by the stored ruleType - that field is
 * decorative (the materializer never reads it) and rules created before this
 * vocabulary existed carry whatever the old dropdown happened to be on. A rule
 * that fits no concept is CUSTOM: still honoured by the engine, still editable,
 * but shown in the advanced drawer rather than pretending to be a season.
 */
export function classifyRule(rule: RuleLike): Concept {
  if (rule.name.startsWith(MANUAL_PREFIX)) return "OVERRIDE";

  const days = parseDays(rule.daysOfWeek);
  const isDayScoped = days !== null && days.length > 0 && days.length < 7;
  const hasDates = rule.startDate !== null || rule.endDate !== null;

  // A day-of-week uplift is the weekend concept whichever days it names -
  // Friday and Saturday are the default, but an operator who set Sat/Sun
  // still means "weekends", and should not be exiled to the advanced drawer.
  if (isDayScoped && rule.adjustment !== null) return "WEEKEND";

  // A named date range with a flat price is a season. An adjustment-based
  // range is legal but rarer, so it stays custom rather than being shown in a
  // form whose only field is a price.
  if (hasDates && rule.price !== null && !isDayScoped) return "SEASON";

  if (!hasDates && !isDayScoped && rule.price !== null) return "BASE";

  return "CUSTOM";
}

/** A season's dates, formatted for a date input. Null bounds read as open-ended. */
export function toDateInput(value: string | Date | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? value : value.toISOString();
  return d.slice(0, 10);
}

/**
 * A plain-language summary of what a rule does, for the advanced drawer where
 * CUSTOM rules have no dedicated form to explain themselves.
 */
export function describeRule(rule: RuleLike, currency: string): string {
  const parts: string[] = [];
  if (rule.price !== null) parts.push(`${currency} ${rule.price}`);
  else if (rule.adjustment !== null) parts.push(`${rule.adjustment > 0 ? "+" : ""}${rule.adjustment}%`);

  const days = parseDays(rule.daysOfWeek);
  if (days && days.length > 0 && days.length < 7) {
    const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    parts.push(days.map((d) => NAMES[d]).join(" "));
  }

  const from = toDateInput(rule.startDate);
  const to = toDateInput(rule.endDate);
  if (from || to) parts.push(`${from || "any"} to ${to || "any"}`);
  else parts.push("every night");

  return parts.join(" · ");
}

/**
 * Order concepts are applied in, lowest first - the same order the materializer
 * resolves them. Stated here so the UI can explain the stack without
 * re-deriving it from priority integers the operator never sees.
 */
export const CONCEPT_ORDER: Concept[] = ["BASE", "SEASON", "WEEKEND", "OVERRIDE"];

export const CONCEPT_LABEL: Record<Concept, string> = {
  BASE: "Base price",
  SEASON: "Season",
  WEEKEND: "Weekend",
  OVERRIDE: "Calendar override",
  CUSTOM: "Custom rule",
};
