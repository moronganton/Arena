import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RATE_PLAN_SET,
  buildDerivedRatePlanPayload,
  buildParentRatePlanPayload,
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
