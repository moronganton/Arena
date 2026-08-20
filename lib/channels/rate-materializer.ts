// Turns a property's basePrice + PricingRule[] + CalendarBlock[] into a
// concrete price/availability/min-stay for each date in a range. Pure
// functions only - no Prisma, no network - so this is fully testable in
// isolation before it ever touches an outbox row or a Channex call.
//
// This is the piece the Channex plan calls out specifically: "Your rule
// engine has been dormant since prices were read from Smoobu - this is
// where it finally does real work." Until now PricingRule only had CRUD
// (app/api/pricing/route.ts) with nothing resolving a rule set down to an
// actual per-date number.

export interface PricingRuleLike {
  ruleType: string; // BASE | WEEKEND | SEASONAL | LAST_MINUTE | MINIMUM_STAY
  startDate: Date | null;
  endDate: Date | null;
  daysOfWeek: string | null; // JSON array, e.g. "[0,6]" (Sun=0..Sat=6)
  price: number | null;
  adjustment: number | null;
  adjType: string | null; // PERCENT | FIXED
  minNights: number | null;
  priority: number;
  active: boolean;
}

export interface CalendarBlockLike {
  startDate: Date;
  endDate: Date; // exclusive, matching Reservation.checkIn/checkOut
}

export interface MaterializedDay {
  date: string; // YYYY-MM-DD
  price: number; // major units (e.g. euros) - the caller converts to minor
  // units at the point of pushing, since that is a Channex-specific
  // encoding detail, not a pricing decision.
  minStay: number;
  available: boolean;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDaysOfWeek(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : null;
  } catch {
    return null;
  }
}

function ruleAppliesOn(rule: PricingRuleLike, date: Date): boolean {
  if (!rule.active) return false;
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  const days = parseDaysOfWeek(rule.daysOfWeek);
  if (days && !days.includes(date.getUTCDay())) return false;
  return true;
}

export interface StayLike {
  checkIn: Date;
  checkOut: Date; // exclusive
}

function isBlocked(date: Date, blocks: CalendarBlockLike[]): boolean {
  return blocks.some((b) => date >= b.startDate && date < b.endDate);
}

// A night someone is already staying in. Half-open like every other range
// here: the checkout date is free again, because that guest leaves in the
// morning and the next can arrive the same afternoon.
function isOccupied(date: Date, stays: StayLike[]): boolean {
  return stays.some((s) => date >= s.checkIn && date < s.checkOut);
}

// Rules apply in priority order, LOWEST first, so a higher-priority rule
// (e.g. a specific holiday override) applies last and wins over a broader
// one (e.g. a season) that also matches the same date - the same "more
// specific beats more general, expressed via an explicit priority number"
// pattern the priority field already implies elsewhere in this codebase.
function resolvePrice(basePrice: number, applicable: PricingRuleLike[]): number {
  let price = basePrice;
  const sorted = [...applicable].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (rule.price != null) {
      price = rule.price;
    } else if (rule.adjustment != null) {
      price = rule.adjType === "FIXED" ? price + rule.adjustment : price * (1 + rule.adjustment / 100);
    }
  }
  return Math.round(price * 100) / 100;
}

// The strictest (largest) minNights among applicable rules wins - taking
// the max only ever tightens the restriction, never loosens one a host
// configured, which is the safe direction to err in if two rules disagree.
function resolveMinStay(applicable: PricingRuleLike[]): number {
  let minStay = 1;
  for (const rule of applicable) {
    if (rule.minNights != null && rule.minNights > minStay) minStay = rule.minNights;
  }
  return minStay;
}

// Existing stays must be passed in, and cancelled ones must be left out by
// the caller. Availability used to be derived from host-set blocks alone,
// which meant a booked night still reported as free: taking a booking pushed
// availability 1 for the very dates it filled, and any later rate change
// re-opened every booked night inside the push window. On a live property
// that is a double booking waiting to happen, and it is also what Channex's
// availability test checks for directly.
export function materializeRates(
  basePrice: number,
  rules: PricingRuleLike[],
  blocks: CalendarBlockLike[],
  dateFrom: Date,
  dateTo: Date, // exclusive, matching the checkIn/checkOut convention used throughout
  stays: StayLike[] = []
): MaterializedDay[] {
  const days: MaterializedDay[] = [];
  const cursor = new Date(Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), dateFrom.getUTCDate()));
  const end = new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate()));

  while (cursor < end) {
    const applicable = rules.filter((r) => ruleAppliesOn(r, cursor));
    days.push({
      date: toDateKey(cursor),
      price: resolvePrice(basePrice, applicable),
      minStay: resolveMinStay(applicable),
      available: !isBlocked(cursor, blocks) && !isOccupied(cursor, stays),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}
