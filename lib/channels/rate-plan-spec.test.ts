import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RATE_PLAN_SET,
  buildRatePlanUpdatePayload,
  derivedPriceFor,
  findTitleCollisions,
  retiredTitle,
  validateRatePlanChanges,
  buildDerivedRatePlanPayload,
  buildParentRatePlanPayload,
  buildParentReusePayload,
  derivedRateOption,
  isParent,
  validateRatePlanSet,
  weeklyDefault,
  type RatePlanPayloadContext,
  type RatePlanSpec,
} from "./rate-plan-spec";

const CTX: RatePlanPayloadContext = {
  channexPropertyId: "prop-sinteu",
  channexRoomTypeId: "rt-sinteu",
  currency: "EUR",
  occupancy: 2,
};

describe("derivedRateOption", () => {
  // Channex takes a direction plus a positive magnitude, never a signed number.
  // Sending ["increase_by_percent", "-15.00"] would be silently wrong in the
  // most expensive possible direction.
  test("a discount becomes decrease_by_percent with a positive magnitude", () => {
    assert.deepEqual(derivedRateOption(-15), [["decrease_by_percent", "15.00"]]);
  });

  test("a surcharge becomes increase_by_percent", () => {
    assert.deepEqual(derivedRateOption(60), [["increase_by_percent", "60.00"]]);
  });

  test("magnitudes are formatted to two decimals", () => {
    assert.deepEqual(derivedRateOption(-7.5), [["decrease_by_percent", "7.50"]]);
  });
});

describe("weeklyDefault", () => {
  test("is seven values, one per weekday", () => {
    assert.deepEqual(weeklyDefault(7), [7, 7, 7, 7, 7, 7, 7]);
  });
});

describe("validateRatePlanSet", () => {
  test("the default set is valid", () => {
    assert.deepEqual(validateRatePlanSet(DEFAULT_RATE_PLAN_SET), []);
  });

  test("the default set is the operator's real Booking.com structure", () => {
    const summary = DEFAULT_RATE_PLAN_SET.map((s) => [s.title, s.derivedPercent, s.minStayArrival]);
    assert.deepEqual(summary, [
      ["Standard Rate", null, 3],
      ["Standard Non-refundable", -5, 3],
      ["Weekly Rate", -15, 7],
      ["Monthly Rate", -25, 28],
      ["2 Day Rate", 20, 2],
      ["1 Day Non-refundable", 60, 1],
    ]);
  });

  test("exactly one parent is required", () => {
    const two: RatePlanSpec[] = [
      { title: "A", derivedPercent: null, minStayArrival: 1 },
      { title: "B", derivedPercent: null, minStayArrival: 1 },
    ];
    assert.ok(validateRatePlanSet(two).some((p) => p.includes("exactly one parent")));
    assert.ok(validateRatePlanSet([]).some((p) => p.includes("exactly one parent")));
  });

  // Provisioning order is array order, and a child cannot reference a parent
  // that has not been created yet.
  test("the parent must come first", () => {
    const backwards: RatePlanSpec[] = [
      { title: "Weekly", derivedPercent: -15, minStayArrival: 7 },
      { title: "Standard", derivedPercent: null, minStayArrival: 1 },
    ];
    assert.ok(validateRatePlanSet(backwards).some((p) => p.includes("must come first")));
  });

  test("rejects a discount that would price the room at or below zero", () => {
    const specs: RatePlanSpec[] = [
      { title: "Standard", derivedPercent: null, minStayArrival: 1 },
      { title: "Free", derivedPercent: -100, minStayArrival: 1 },
    ];
    assert.ok(validateRatePlanSet(specs).some((p) => p.includes("at or below zero")));
  });

  test("rejects a 0% child as a duplicate of its parent", () => {
    const specs: RatePlanSpec[] = [
      { title: "Standard", derivedPercent: null, minStayArrival: 1 },
      { title: "Same", derivedPercent: 0, minStayArrival: 1 },
    ];
    assert.ok(validateRatePlanSet(specs).some((p) => p.includes("duplicate")));
  });

  test("rejects duplicate titles", () => {
    const specs: RatePlanSpec[] = [
      { title: "Standard", derivedPercent: null, minStayArrival: 1 },
      { title: "standard", derivedPercent: -5, minStayArrival: 1 },
    ];
    assert.ok(validateRatePlanSet(specs).some((p) => p.includes("unique")));
  });

  test("isParent is decided by the absence of a percentage", () => {
    assert.equal(isParent({ title: "S", derivedPercent: null, minStayArrival: 1 }), true);
    assert.equal(isParent({ title: "W", derivedPercent: -15, minStayArrival: 7 }), false);
  });
});

describe("buildParentRatePlanPayload", () => {
  const payload = buildParentRatePlanPayload(DEFAULT_RATE_PLAN_SET[0], CTX).rate_plan;

  test("is manual with no parent", () => {
    assert.equal(payload.rate_mode, "manual");
    assert.equal(payload.parent_rate_plan_id, null);
  });

  test("sells the whole unit, not per person", () => {
    assert.equal(payload.sell_mode, "per_room");
    assert.deepEqual(payload.options, [{ occupancy: 2, is_primary: true, rate: 0 }]);
  });

  test("carries its own minimum stay as a weekly default", () => {
    assert.deepEqual(payload.min_stay_arrival, [3, 3, 3, 3, 3, 3, 3]);
  });

  test("is scoped to the property and room type it was given", () => {
    assert.equal(payload.property_id, "prop-sinteu");
    assert.equal(payload.room_type_id, "rt-sinteu");
    assert.equal(payload.currency, "EUR");
  });
});

describe("buildDerivedRatePlanPayload", () => {
  const weekly = DEFAULT_RATE_PLAN_SET.find((s) => s.title === "Weekly Rate")!;
  const payload = buildDerivedRatePlanPayload(weekly, "parent-id", CTX).rate_plan;

  test("derives from the named parent", () => {
    assert.equal(payload.rate_mode, "derived");
    assert.equal(payload.parent_rate_plan_id, "parent-id");
    assert.equal(payload.inherit_rate, true);
  });

  test("applies the discount as a derived_option", () => {
    assert.deepEqual(payload.options, [
      {
        occupancy: 2,
        is_primary: true,
        derived_option: { rate: [["decrease_by_percent", "15.00"]] },
      },
    ]);
  });

  // The single most important flag in this file. The parent receives a per-date
  // min_stay_arrival on every ARI push; a child left inheriting would have its
  // own restriction flattened on the next drain cycle, collapsing six distinct
  // products back into one.
  test("does NOT inherit min stay from the parent", () => {
    assert.equal(payload.inherit_min_stay_arrival, false);
    assert.deepEqual(payload.min_stay_arrival, [7, 7, 7, 7, 7, 7, 7]);
  });

  test("a short-stay plan is a surcharge, not a discount", () => {
    const oneDay = DEFAULT_RATE_PLAN_SET.find((s) => s.title === "1 Day Non-refundable")!;
    const p = buildDerivedRatePlanPayload(oneDay, "parent-id", CTX).rate_plan;
    assert.deepEqual(p.options[0].derived_option.rate, [["increase_by_percent", "60.00"]]);
    assert.deepEqual(p.min_stay_arrival, [1, 1, 1, 1, 1, 1, 1]);
  });

  test("refuses to build a derived payload for a parent spec", () => {
    assert.throws(() => buildDerivedRatePlanPayload(DEFAULT_RATE_PLAN_SET[0], "parent-id", CTX));
  });
});

describe("findTitleCollisions", () => {
  // The 422 this exists to prevent: every property's first rate plan is called
  // "Standard Rate" (see /api/channex/provision), and the default family's
  // parent carries that same name, so a first provisioning always collides.
  test("catches the Standard Rate collision the default set always hits", () => {
    assert.deepEqual(findTitleCollisions(DEFAULT_RATE_PLAN_SET, ["Standard Rate"]), ["Standard Rate"]);
  });

  test("no collision against unrelated titles", () => {
    assert.deepEqual(findTitleCollisions(DEFAULT_RATE_PLAN_SET, ["Corporate Rate", "Long Stay"]), []);
  });

  test("comparison ignores case and surrounding space", () => {
    assert.deepEqual(findTitleCollisions(DEFAULT_RATE_PLAN_SET, ["  standard RATE "]), ["Standard Rate"]);
  });

  test("reports every colliding title, not just the first", () => {
    const found = findTitleCollisions(DEFAULT_RATE_PLAN_SET, ["Standard Rate", "Weekly Rate"]);
    assert.deepEqual(found, ["Standard Rate", "Weekly Rate"]);
  });

  test("nothing existing means nothing collides", () => {
    assert.deepEqual(findTitleCollisions(DEFAULT_RATE_PLAN_SET, []), []);
  });
});

describe("retiredTitle", () => {
  test("suffixes with the plan's own id, not a timestamp", () => {
    assert.equal(
      retiredTitle("Standard Rate", "4c7127bc-41f6-4eea-a575-4e9829f39fdb"),
      "Standard Rate (retired 4c7127bc)"
    );
  });

  // Re-running a failed provisioning must not produce
  // "Standard Rate (retired 4c7127bc) (retired 4c7127bc)".
  test("is idempotent - retiring an already-retired title changes nothing", () => {
    const once = retiredTitle("Standard Rate", "4c7127bc-41f6-4eea-a575-4e9829f39fdb");
    assert.equal(retiredTitle(once, "4c7127bc-41f6-4eea-a575-4e9829f39fdb"), once);
  });

  test("two different plans retire to two different titles", () => {
    const a = retiredTitle("Standard Rate", "aaaaaaaa-1111-2222-3333-444444444444");
    const b = retiredTitle("Standard Rate", "bbbbbbbb-1111-2222-3333-444444444444");
    assert.notEqual(a, b);
  });
});

describe("validateRatePlanChanges", () => {
  test("accepts an ordinary edit", () => {
    assert.deepEqual(validateRatePlanChanges({ derivedPercent: 100, minStayArrival: 2 }, false, []), []);
  });

  // The edit that started this: 2 Day Rate at +20% gives €120 off a €100
  // parent, and the operator wanted €200.
  test("+100% is a valid way to double the parent", () => {
    assert.deepEqual(validateRatePlanChanges({ derivedPercent: 100 }, false, []), []);
  });

  test("refuses a percentage on the parent", () => {
    const p = validateRatePlanChanges({ derivedPercent: -10 }, true, []);
    assert.ok(p.some((x) => x.includes("receives prices from your pricing rules")));
  });

  test("refuses a title another plan already uses, case-insensitively", () => {
    const p = validateRatePlanChanges({ title: "weekly RATE" }, false, ["Weekly Rate"]);
    assert.ok(p.some((x) => x.includes("already used")));
  });

  test("allows keeping a title that is not on the sibling list", () => {
    assert.deepEqual(validateRatePlanChanges({ title: "Weekly Rate" }, false, ["Monthly Rate"]), []);
  });

  test("refuses a discount at or past 100%", () => {
    assert.ok(validateRatePlanChanges({ derivedPercent: -100 }, false, []).length > 0);
  });

  test("refuses a minimum stay below 1", () => {
    assert.ok(validateRatePlanChanges({ minStayArrival: 0 }, false, []).length > 0);
  });
});

describe("buildRatePlanUpdatePayload", () => {
  // A PUT carrying every field would rewrite parent_rate_plan_id and the
  // inherit flags on every edit - which is how renaming a plan detaches it
  // from its family.
  test("sends only what changed", () => {
    assert.deepEqual(buildRatePlanUpdatePayload({ title: "New name" }, 2), {
      rate_plan: { title: "New name" },
    });
  });

  test("a percentage change carries the derived option and nothing else", () => {
    const p = buildRatePlanUpdatePayload({ derivedPercent: 100 }, 2).rate_plan;
    assert.deepEqual(Object.keys(p), ["options"]);
    assert.deepEqual(p.options, [
      { occupancy: 2, is_primary: true, derived_option: { rate: [["increase_by_percent", "100.00"]] } },
    ]);
  });

  test("min stay becomes the seven-day default array", () => {
    assert.deepEqual(buildRatePlanUpdatePayload({ minStayArrival: 4 }, 2).rate_plan.min_stay_arrival,
      [4, 4, 4, 4, 4, 4, 4]);
  });

  test("an empty change set produces an empty payload", () => {
    assert.deepEqual(buildRatePlanUpdatePayload({}, 2), { rate_plan: {} });
  });
});

describe("derivedPriceFor", () => {
  test("the parent quotes what it is given", () => {
    assert.equal(derivedPriceFor(115, null), 115);
  });

  test("+100% doubles it - the edit this feature exists for", () => {
    assert.equal(derivedPriceFor(100, 100), 200);
  });

  test("−15% off 115 rounds to cents", () => {
    assert.equal(derivedPriceFor(115, -15), 97.75);
  });
});

describe("deriving by a fixed amount", () => {
  // Booking.com's "Price difference" control offers a currency and a percent
  // side by side, so a mirrored plan can carry either. Breakfast is the case
  // that needs the amount: EUR 12 a night is a fixed cost.
  it("emits Channex's amount modifier, not a percent one", () => {
    assert.deepEqual(derivedRateOption({ derivedPercent: null, derivedAmount: 12 }), [
      ["increase_by_amount", "12.00"],
    ]);
    assert.deepEqual(derivedRateOption({ derivedPercent: null, derivedAmount: -5 }), [
      ["decrease_by_amount", "5.00"],
    ]);
  });

  it("still emits percent when that is what the plan uses", () => {
    assert.deepEqual(derivedRateOption({ derivedPercent: -15, derivedAmount: null }), [
      ["decrease_by_percent", "15.00"],
    ]);
    // The bare-number form the rest of the app still uses.
    assert.deepEqual(derivedRateOption(-15), [["decrease_by_percent", "15.00"]]);
  });

  it("adds the amount rather than scaling by it", () => {
    assert.equal(derivedPriceFor(120, { derivedPercent: null, derivedAmount: 12 }), 132);
    // The whole point: the same plan on a dearer night adds the same 12.
    assert.equal(derivedPriceFor(200, { derivedPercent: null, derivedAmount: 12 }), 212);
    // Where a percent would have drifted.
    assert.equal(derivedPriceFor(200, { derivedPercent: 10, derivedAmount: null }), 220);
  });

  it("never previews a negative price", () => {
    assert.equal(derivedPriceFor(10, { derivedPercent: null, derivedAmount: -50 }), 0);
  });

  it("the parent is still whatever the rules resolved", () => {
    assert.equal(derivedPriceFor(115, { derivedPercent: null, derivedAmount: null }), 115);
    assert.equal(derivedPriceFor(115, null), 115);
  });

  it("a plan cannot follow its parent by both at once", () => {
    const problems = validateRatePlanSet([
      { title: "Standard Rate", derivedPercent: null, derivedAmount: null, minStayArrival: 1 },
      { title: "Breakfast", derivedPercent: 10, derivedAmount: 12, minStayArrival: 1 },
    ]);
    assert.ok(problems.some((p) => /percentage OR a fixed amount/.test(p)));
  });

  it("a zero difference is a duplicate whichever unit it is in", () => {
    const problems = validateRatePlanSet([
      { title: "Standard Rate", derivedPercent: null, derivedAmount: null, minStayArrival: 1 },
      { title: "Breakfast", derivedPercent: null, derivedAmount: 0, minStayArrival: 1 },
    ]);
    assert.ok(problems.some((p) => /duplicate of it/.test(p)));
  });

  it("an amount-derived plan is not mistaken for the parent", () => {
    const problems = validateRatePlanSet([
      { title: "Standard Rate", derivedPercent: null, derivedAmount: null, minStayArrival: 1 },
      { title: "Breakfast", derivedPercent: null, derivedAmount: 12, minStayArrival: 1 },
    ]);
    assert.deepEqual(problems, []);
  });

  it("builds a derived payload carrying the amount and the meal type", () => {
    const payload = buildDerivedRatePlanPayload(
      { title: "Rate with breakfast", derivedPercent: null, derivedAmount: 12, minStayArrival: 3, mealType: "breakfast" },
      "parent-id",
      { channexPropertyId: "p", channexRoomTypeId: "r", currency: "EUR", occupancy: 4 }
    );
    assert.deepEqual(payload.rate_plan.options[0].derived_option.rate, [["increase_by_amount", "12.00"]]);
    assert.equal(payload.rate_plan.meal_type, "breakfast");
  });

  it("a plan with no meal carries no meal_type at all", () => {
    const payload = buildDerivedRatePlanPayload(
      { title: "Non-refundable", derivedPercent: -10, minStayArrival: 3 },
      "parent-id",
      { channexPropertyId: "p", channexRoomTypeId: "r", currency: "EUR", occupancy: 4 }
    );
    assert.ok(!("meal_type" in payload.rate_plan));
  });
});

describe("buildParentReusePayload", () => {
  const ctx = { channexPropertyId: "p", channexRoomTypeId: "r", currency: "EUR", occupancy: 4 };

  it("renames a plan into the parent role without recreating it", () => {
    const p = buildParentReusePayload(
      { title: "Standard Rate", derivedPercent: null, minStayArrival: 3 },
      ctx
    ).rate_plan;
    assert.equal(p.title, "Standard Rate");
    assert.deepEqual(p.min_stay_arrival, [3, 3, 3, 3, 3, 3, 3]);
  });

  it("stops the plan deriving from anything, so Channex no longer recomputes it", () => {
    const p = buildParentReusePayload(
      { title: "Standard Rate", derivedPercent: null, minStayArrival: 1 },
      ctx
    ).rate_plan;
    assert.equal(p.parent_rate_plan_id, null);
    assert.equal(p.options[0].derived_option, null);
  });

  it("never resends the structural fields a channel maps through", () => {
    // Resending these on an update is how a rename detaches a plan from the
    // room type a channel is mapped to.
    const p = buildParentReusePayload(
      { title: "Standard Rate", derivedPercent: null, minStayArrival: 1 },
      ctx
    ).rate_plan as Record<string, unknown>;
    for (const key of ["property_id", "room_type_id", "sell_mode", "rate_mode", "currency"]) {
      assert.ok(!(key in p), `${key} must not be resent`);
    }
  });

  it("never resets the rate, which would blank a live listing", () => {
    const p = buildParentReusePayload(
      { title: "Standard Rate", derivedPercent: null, minStayArrival: 1 },
      ctx
    ).rate_plan;
    assert.ok(!("rate" in p.options[0]));
  });

  it("carries a meal type only when the plan has one", () => {
    const withMeal = buildParentReusePayload(
      { title: "B&B Rate", derivedPercent: null, minStayArrival: 1, mealType: "breakfast" },
      ctx
    ).rate_plan as Record<string, unknown>;
    assert.equal(withMeal.meal_type, "breakfast");
    const without = buildParentReusePayload(
      { title: "Standard Rate", derivedPercent: null, minStayArrival: 1 },
      ctx
    ).rate_plan as Record<string, unknown>;
    assert.ok(!("meal_type" in without));
  });
});
