// What a rate plan family looks like, and the exact JSON Channex is asked to
// create for it.
//
// Pure functions only - no Prisma, no network. The payloads below are written
// to a live property that real guests book, so the shape of them is worth being
// able to assert without making a request.

export interface RatePlanSpec {
  title: string;
  // Null on the parent. Positive is a surcharge, negative a discount - a weekly
  // rate at -15%, a single night at +60%.
  derivedPercent: number | null;
  minStayArrival: number;
}

// The default family, mirroring the structure this operator already runs on
// Booking.com: one Standard Rate everything else derives from, discounts as the
// stay lengthens, premiums as it shortens.
//
// Order matters - the parent must exist before anything can point at it - so
// this array is also the provisioning order.
export const DEFAULT_RATE_PLAN_SET: RatePlanSpec[] = [
  { title: "Standard Rate", derivedPercent: null, minStayArrival: 3 },
  { title: "Standard Non-refundable", derivedPercent: -5, minStayArrival: 3 },
  { title: "Weekly Rate", derivedPercent: -15, minStayArrival: 7 },
  { title: "Monthly Rate", derivedPercent: -25, minStayArrival: 28 },
  { title: "2 Day Rate", derivedPercent: 20, minStayArrival: 2 },
  { title: "1 Day Non-refundable", derivedPercent: 60, minStayArrival: 1 },
];

export function isParent(spec: RatePlanSpec): boolean {
  return spec.derivedPercent === null;
}

export function validateRatePlanSet(specs: RatePlanSpec[]): string[] {
  const problems: string[] = [];
  const parents = specs.filter(isParent);
  if (parents.length !== 1) {
    problems.push(`a rate plan set needs exactly one parent, found ${parents.length}`);
  }
  if (specs.length > 0 && !isParent(specs[0])) {
    problems.push("the parent must come first - nothing can derive from a plan that does not exist yet");
  }
  for (const s of specs) {
    if (!s.title.trim()) problems.push("every rate plan needs a title");
    if (s.minStayArrival < 1) problems.push(`${s.title}: minimum stay must be at least 1`);
    if (s.derivedPercent !== null && s.derivedPercent === 0) {
      problems.push(`${s.title}: a 0% derived plan is a duplicate of its parent`);
    }
    if (s.derivedPercent !== null && s.derivedPercent <= -100) {
      problems.push(`${s.title}: a discount of ${s.derivedPercent}% would price the room at or below zero`);
    }
  }
  const titles = specs.map((s) => s.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) problems.push("rate plan titles must be unique");
  return problems;
}

// Channex rejects a rate plan whose title already exists on the property -
// "Duplication in Rate Plan title is not allowed!", a 422 raised at create
// time. Since the first plan a property ever gets is called "Standard Rate"
// (see /api/channex/provision), provisioning a family whose parent carries
// that same name collides with it every time.
//
// Detected up front rather than discovered mid-run: a collision on the third
// child would leave a half-built family behind, where a collision found before
// the first call leaves nothing at all.
export function findTitleCollisions(specs: RatePlanSpec[], existingTitles: string[]): string[] {
  const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return specs.filter((s) => existing.has(s.title.trim().toLowerCase())).map((s) => s.title);
}

// What a plan being replaced is renamed to, so its title stops colliding with
// the family taking over. Suffixed with the plan's own id rather than a
// timestamp so running this twice is idempotent instead of stacking
// "(retired) (retired)".
export function retiredTitle(currentTitle: string, channexRatePlanId: string): string {
  const short = channexRatePlanId.slice(0, 8);
  return currentTitle.includes(`(retired ${short})`)
    ? currentTitle
    : `${currentTitle} (retired ${short})`;
}

// What a derived plan quotes when the parent quotes parentPrice.
//
// Channex computes this itself - nothing here is pushed - so this exists only
// to SHOW the operator what their one price becomes across the family. Rounded
// to cents the same way resolvePrice rounds, so the preview and the real number
// agree.
export function derivedPriceFor(parentPrice: number, percent: number | null): number {
  if (percent === null) return Math.round(parentPrice * 100) / 100;
  return Math.round(parentPrice * (1 + percent / 100) * 100) / 100;
}

// Channex expresses a modifier as a direction plus a positive magnitude, not as
// a signed number. -15 becomes ["decrease_by_percent", "15.00"].
export function derivedRateOption(percent: number): [string, string][] {
  const direction = percent < 0 ? "decrease_by_percent" : "increase_by_percent";
  return [[direction, Math.abs(percent).toFixed(2)]];
}

// min_stay_arrival on a rate plan is seven defaults, one per weekday, applied
// to dates that have not been given an explicit value. StayHQ pushes explicit
// per-date restrictions to the PARENT only, so for a derived plan this array is
// what its minimum stay actually is.
export function weeklyDefault(value: number): number[] {
  return Array(7).fill(value);
}

export interface RatePlanPayloadContext {
  channexPropertyId: string;
  channexRoomTypeId: string;
  currency: string;
  occupancy: number;
}

// Sold per room, not per person: a StayHQ listing is a whole apartment, so
// there is one option at the unit's maximum occupancy rather than a price
// ladder by guest count.
export function buildParentRatePlanPayload(spec: RatePlanSpec, ctx: RatePlanPayloadContext) {
  return {
    rate_plan: {
      property_id: ctx.channexPropertyId,
      room_type_id: ctx.channexRoomTypeId,
      title: spec.title,
      currency: ctx.currency,
      sell_mode: "per_room",
      rate_mode: "manual",
      parent_rate_plan_id: null,
      // Zero is deliberate: the real price arrives on the first ARI push, and a
      // plausible-looking placeholder is worse than an obviously unset one if
      // that push never happens.
      options: [{ occupancy: ctx.occupancy, is_primary: true, rate: 0 }],
      min_stay_arrival: weeklyDefault(spec.minStayArrival),
    },
  };
}

export function buildDerivedRatePlanPayload(
  spec: RatePlanSpec,
  parentChannexRatePlanId: string,
  ctx: RatePlanPayloadContext
) {
  if (spec.derivedPercent === null) {
    throw new Error(`buildDerivedRatePlanPayload: ${spec.title} has no derivedPercent`);
  }
  return {
    rate_plan: {
      property_id: ctx.channexPropertyId,
      room_type_id: ctx.channexRoomTypeId,
      title: spec.title,
      currency: ctx.currency,
      sell_mode: "per_room",
      rate_mode: "derived",
      parent_rate_plan_id: parentChannexRatePlanId,
      inherit_rate: true,
      // The one thing a derived plan must NOT inherit. Its own minimum stay is
      // the whole reason it is a separate product, and the parent receives a
      // per-date min_stay_arrival on every ARI push - left inheriting, that
      // push would flatten every child's restriction on the next cycle and
      // collapse six products back into one.
      inherit_min_stay_arrival: false,
      min_stay_arrival: weeklyDefault(spec.minStayArrival),
      options: [
        {
          occupancy: ctx.occupancy,
          is_primary: true,
          derived_option: { rate: derivedRateOption(spec.derivedPercent) },
        },
      ],
    },
  };
}
