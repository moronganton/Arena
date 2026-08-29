// What a rate plan family looks like, and the exact JSON Channex is asked to
// create for it.
//
// Pure functions only - no Prisma, no network. The payloads below are written
// to a live property that real guests book, so the shape of them is worth being
// able to assert without making a request.

export interface RatePlanSpec {
  title: string;
  // How this plan follows the parent. Exactly one of derivedPercent and
  // derivedAmount is set on a derived plan; both are null on the parent.
  //
  // Percent: positive is a surcharge, negative a discount - a weekly rate at
  // -15%, a single night at +60%.
  derivedPercent: number | null;
  // A flat amount in the property's currency. Breakfast is the case that needs
  // it: EUR 12 a night is a fixed cost, and expressing it as a percent is right
  // at one base price and wrong at every other. Booking.com's own "Price
  // difference" control offers a currency and a percent side by side.
  derivedAmount?: number | null;
  minStayArrival: number;
  // Channex's meal_type. Only set when the plan actually includes a meal, so
  // an ordinary plan carries nothing rather than an explicit "none" this app
  // never asked anyone about.
  mealType?: string | null;
}

/** How a plan's price difference reads in a log line or a step description. */
export function describeDerivation(spec: {
  derivedPercent: number | null;
  derivedAmount?: number | null;
}): string {
  const d = derivationOf(spec);
  if (d === null) return "the main rate";
  const sign = d.value > 0 ? "+" : "";
  return d.kind === "amount" ? `${sign}${d.value}` : `${sign}${d.value}%`;
}

/** A derived plan follows its parent by exactly one of these. */
export function derivationOf(spec: {
  derivedPercent: number | null;
  derivedAmount?: number | null;
}): { kind: "percent" | "amount"; value: number } | null {
  if (spec.derivedAmount !== null && spec.derivedAmount !== undefined) {
    return { kind: "amount", value: spec.derivedAmount };
  }
  if (spec.derivedPercent !== null && spec.derivedPercent !== undefined) {
    return { kind: "percent", value: spec.derivedPercent };
  }
  return null;
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
  return derivationOf(spec) === null;
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
    if (s.derivedPercent !== null && s.derivedPercent !== undefined &&
        s.derivedAmount !== null && s.derivedAmount !== undefined) {
      problems.push(
        `${s.title}: a plan follows its parent by a percentage OR a fixed amount, not both`
      );
    }
    const d = derivationOf(s);
    if (d?.value === 0) {
      problems.push(`${s.title}: a plan priced the same as its parent is a duplicate of it`);
    }
    if (d?.kind === "percent" && d.value <= -100) {
      problems.push(`${s.title}: a discount of ${d.value}% would price the room at or below zero`);
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
export function derivedPriceFor(
  parentPrice: number,
  derivation: { derivedPercent: number | null; derivedAmount?: number | null } | number | null
): number {
  // The old signature took a bare percent, and enough call sites still read
  // naturally that way to keep it working rather than churn them all.
  const spec =
    typeof derivation === "number"
      ? { derivedPercent: derivation, derivedAmount: null }
      : derivation === null
        ? { derivedPercent: null, derivedAmount: null }
        : derivation;

  const d = derivationOf(spec);
  if (d === null) return Math.round(parentPrice * 100) / 100;
  const raw = d.kind === "amount" ? parentPrice + d.value : parentPrice * (1 + d.value / 100);
  // A fixed discount larger than the night's price would quote a negative
  // number. Channex would reject it, but showing it as a preview is worse -
  // it reads as a real offer rather than a misconfiguration.
  return Math.round(Math.max(0, raw) * 100) / 100;
}

// Channex expresses a modifier as a direction plus a positive magnitude, not as
// a signed number. -15 becomes ["decrease_by_percent", "15.00"].
export function derivedRateOption(
  derivation: { derivedPercent: number | null; derivedAmount?: number | null } | number
): [string, string][] {
  const spec =
    typeof derivation === "number" ? { derivedPercent: derivation, derivedAmount: null } : derivation;
  const d = derivationOf(spec);
  if (d === null) throw new Error("derivedRateOption: nothing to derive by");
  const unit = d.kind === "amount" ? "amount" : "percent";
  const direction = d.value < 0 ? `decrease_by_${unit}` : `increase_by_${unit}`;
  return [[direction, Math.abs(d.value).toFixed(2)]];
}

// min_stay_arrival on a rate plan is seven defaults, one per weekday, applied
// to dates that have not been given an explicit value. StayHQ pushes explicit
// per-date restrictions to the PARENT only, so for a derived plan this array is
// what its minimum stay actually is.
export function weeklyDefault(value: number): number[] {
  return Array(7).fill(value);
}

// Changing a plan that already exists, as opposed to creating one.
//
// Only the fields an operator can actually change. Everything else about a
// derived plan - which parent it follows, that it inherits the rate, that it
// does NOT inherit min stay - is structural, and letting a form edit it would
// only ever break the family.
export interface RatePlanChanges {
  title?: string;
  derivedPercent?: number | null;
  derivedAmount?: number | null;
  minStayArrival?: number;
  mealType?: string | null;
}

export function validateRatePlanChanges(
  changes: RatePlanChanges,
  isParentPlan: boolean,
  otherTitles: string[]
): string[] {
  const problems: string[] = [];

  if (changes.title !== undefined) {
    if (!changes.title.trim()) problems.push("a rate plan needs a title");
    const taken = new Set(otherTitles.map((t) => t.trim().toLowerCase()));
    if (taken.has(changes.title.trim().toLowerCase())) {
      problems.push(`"${changes.title}" is already used by another rate plan on this property`);
    }
  }

  if (changes.minStayArrival !== undefined && changes.minStayArrival < 1) {
    problems.push("minimum stay must be at least 1");
  }

  const changingDerivation =
    changes.derivedPercent !== undefined || changes.derivedAmount !== undefined;
  if (changingDerivation) {
    // The parent is where prices arrive from the pricing rules; it has nothing
    // to derive from, and giving it a difference would silently do nothing.
    if (isParentPlan) {
      problems.push(
        "the parent plan has no price difference - it receives prices from your pricing rules"
      );
    }
    if (
      changes.derivedPercent !== undefined && changes.derivedPercent !== null &&
      changes.derivedAmount !== undefined && changes.derivedAmount !== null
    ) {
      problems.push("a plan follows its parent by a percentage OR a fixed amount, not both");
    }
    const d = derivationOf({
      derivedPercent: changes.derivedPercent ?? null,
      derivedAmount: changes.derivedAmount ?? null,
    });
    if (d?.value === 0) problems.push("a plan priced the same as its parent is a duplicate of it");
    if (d?.kind === "percent" && d.value <= -100) {
      problems.push(`a discount of ${d.value}% would price the room at or below zero`);
    }
  }

  return problems;
}

// Only the keys being changed are sent. A PUT carrying every field would
// rewrite parent_rate_plan_id and the inherit flags on every edit, which is how
// a form that only meant to rename something detaches a plan from its family.
export function buildRatePlanUpdatePayload(
  changes: RatePlanChanges,
  occupancy: number
): { rate_plan: Record<string, unknown> } {
  const rate_plan: Record<string, unknown> = {};
  if (changes.title !== undefined) rate_plan.title = changes.title.trim();
  if (changes.minStayArrival !== undefined) {
    rate_plan.min_stay_arrival = weeklyDefault(changes.minStayArrival);
  }
  if (changes.mealType !== undefined) rate_plan.meal_type = changes.mealType ?? "none";
  if (changes.derivedPercent !== undefined || changes.derivedAmount !== undefined) {
    rate_plan.options = [
      {
        occupancy,
        is_primary: true,
        derived_option: {
          rate: derivedRateOption({
            derivedPercent: changes.derivedPercent ?? null,
            derivedAmount: changes.derivedAmount ?? null,
          }),
        },
      },
    ];
  }
  return { rate_plan };
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
      ...(spec.mealType ? { meal_type: spec.mealType } : {}),
    },
  };
}

// Turning a plan that already exists into this family's parent, without
// creating anything.
//
// Only the fields a parent needs, and deliberately NOT property_id,
// room_type_id or sell_mode: those are structural, already correct on a plan
// this listing has been pushing into, and resending them on an update is how a
// rename detaches a plan from the room type a channel maps to.
//
// The rate is not sent either. The plan is already carrying real prices from
// earlier pushes, and resetting it to 0 would blank a live listing until the
// next ARI cycle.
export function buildParentReusePayload(spec: RatePlanSpec, ctx: RatePlanPayloadContext) {
  return {
    rate_plan: {
      title: spec.title,
      min_stay_arrival: weeklyDefault(spec.minStayArrival),
      // A plan that was derived from something else must stop being derived
      // when it becomes the parent, or Channex would go on recomputing it.
      parent_rate_plan_id: null,
      options: [{ occupancy: ctx.occupancy, is_primary: true, derived_option: null }],
      ...(spec.mealType ? { meal_type: spec.mealType } : {}),
    },
  };
}

export function buildDerivedRatePlanPayload(
  spec: RatePlanSpec,
  parentChannexRatePlanId: string,
  ctx: RatePlanPayloadContext
) {
  if (derivationOf(spec) === null) {
    throw new Error(`buildDerivedRatePlanPayload: ${spec.title} has no price difference`);
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
      ...(spec.mealType ? { meal_type: spec.mealType } : {}),
      options: [
        {
          occupancy: ctx.occupancy,
          is_primary: true,
          derived_option: { rate: derivedRateOption(spec) },
        },
      ],
    },
  };
}
