import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { materializeRates, ruleAppliesOn, type PricingRuleLike } from "./rate-materializer";

// September 2026 starts on a Tuesday, so this week runs Tue..Mon and contains
// exactly one Fri (getUTCDay 5) and one Sat (6). Every date below is UTC
// midnight, matching how the materializer walks its cursor.
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TUE = d("2026-09-01");
const NEXT_TUE = d("2026-09-08"); // exclusive end

function rule(over: Partial<PricingRuleLike> = {}): PricingRuleLike {
  return {
    ruleType: "SEASONAL",
    startDate: null,
    endDate: null,
    daysOfWeek: null,
    price: null,
    adjustment: null,
    adjType: "PERCENT",
    minNights: null,
    priority: 0,
    active: true,
    ...over,
  };
}

const priceOn = (days: ReturnType<typeof materializeRates>, iso: string) =>
  days.find((x) => x.date === iso)!.price;

describe("ruleAppliesOn", () => {
  // The question the operator kept asking: must a rule carry a date range?
  // No - a rule with neither bound applies to every date it is asked about,
  // which is what makes "weekends are always +25%" expressible without
  // painting a year of dates.
  test("a rule with no dates applies to any date", () => {
    const r = rule();
    assert.equal(ruleAppliesOn(r, d("2026-01-01")), true);
    assert.equal(ruleAppliesOn(r, d("2030-12-31")), true);
  });

  test("endDate is inclusive - the last day still applies", () => {
    const r = rule({ startDate: d("2026-09-01"), endDate: d("2026-09-03") });
    assert.equal(ruleAppliesOn(r, d("2026-09-03")), true, "the end day itself is in range");
    assert.equal(ruleAppliesOn(r, d("2026-09-04")), false);
    assert.equal(ruleAppliesOn(r, d("2026-08-31")), false);
  });

  test("an inactive rule never applies", () => {
    assert.equal(ruleAppliesOn(rule({ active: false }), TUE), false);
  });

  test("daysOfWeek restricts to those weekdays", () => {
    const weekend = rule({ daysOfWeek: "[5,6]" });
    assert.equal(ruleAppliesOn(weekend, d("2026-09-04")), true, "Friday");
    assert.equal(ruleAppliesOn(weekend, d("2026-09-05")), true, "Saturday");
    assert.equal(ruleAppliesOn(weekend, d("2026-09-03")), false, "Thursday");
  });

  test("malformed daysOfWeek JSON does not restrict", () => {
    assert.equal(ruleAppliesOn(rule({ daysOfWeek: "not json" }), TUE), true);
  });
});

describe("price resolution", () => {
  test("falls back to base price when nothing matches", () => {
    const days = materializeRates(90, [], [], TUE, NEXT_TUE);
    assert.equal(days.length, 7);
    assert.ok(days.every((x) => x.price === 90));
  });

  test("a flat price replaces the base", () => {
    const days = materializeRates(90, [rule({ price: 140 })], [], TUE, NEXT_TUE);
    assert.ok(days.every((x) => x.price === 140));
  });

  test("a percentage adjustment modifies the base", () => {
    const days = materializeRates(100, [rule({ adjustment: 25 })], [], TUE, NEXT_TUE);
    assert.ok(days.every((x) => x.price === 125));
  });

  test("a FIXED adjustment adds to the base", () => {
    const days = materializeRates(100, [rule({ adjustment: 15, adjType: "FIXED" })], [], TUE, NEXT_TUE);
    assert.ok(days.every((x) => x.price === 115));
  });

  // The ordering trap, pinned. Rules apply in ASCENDING priority, so the
  // highest-priority rule is applied LAST and wins. A flat price overwrites
  // whatever came before it; an adjustment compounds on it.
  test("a percentage at higher priority compounds on a season's flat price", () => {
    const days = materializeRates(
      90,
      [
        rule({ price: 140, priority: 10 }), // season, applied first
        rule({ adjustment: 25, daysOfWeek: "[5,6]", priority: 20 }), // weekend, applied last
      ],
      [],
      TUE,
      NEXT_TUE
    );
    assert.equal(priceOn(days, "2026-09-04"), 175, "Friday: 140 * 1.25");
    assert.equal(priceOn(days, "2026-09-03"), 140, "Thursday: season only");
  });

  // The same two rules with priorities swapped silently discard the uplift.
  // This is the behaviour operators get wrong, so it is asserted rather than
  // left to be rediscovered against a live calendar.
  test("a flat price at higher priority DISCARDS a lower-priority uplift", () => {
    const days = materializeRates(
      90,
      [
        rule({ adjustment: 25, daysOfWeek: "[5,6]", priority: 10 }), // applied first
        rule({ price: 140, priority: 20 }), // season overwrites it
      ],
      [],
      TUE,
      NEXT_TUE
    );
    assert.equal(priceOn(days, "2026-09-04"), 140, "the +25% is computed and then thrown away");
  });

  test("prices are rounded to cents", () => {
    const days = materializeRates(100, [rule({ adjustment: -7 })], [], TUE, NEXT_TUE);
    assert.equal(days[0].price, 93);
  });
});

describe("minimum stay", () => {
  test("defaults to 1", () => {
    const days = materializeRates(90, [], [], TUE, NEXT_TUE);
    assert.ok(days.every((x) => x.minStay === 1));
  });

  // Unlike price, min stay ignores priority entirely and takes the MAXIMUM.
  // Two rules disagreeing on price is settled by authority; on min stay, by
  // caution - an overlap may only ever tighten a restriction the host set.
  test("takes the strictest value, not the highest-priority one", () => {
    const days = materializeRates(
      90,
      [
        rule({ minNights: 5, priority: 1 }),
        rule({ minNights: 2, priority: 99 }), // higher priority, looser - must not win
      ],
      [],
      TUE,
      NEXT_TUE
    );
    assert.ok(days.every((x) => x.minStay === 5));
  });

  test("only counts rules that apply on the date", () => {
    const days = materializeRates(90, [rule({ minNights: 3, daysOfWeek: "[5]" })], [], TUE, NEXT_TUE);
    assert.equal(days.find((x) => x.date === "2026-09-04")!.minStay, 3, "Friday");
    assert.equal(days.find((x) => x.date === "2026-09-03")!.minStay, 1, "Thursday");
  });
});

describe("availability", () => {
  test("open when nothing blocks or occupies", () => {
    const days = materializeRates(90, [], [], TUE, NEXT_TUE);
    assert.ok(days.every((x) => x.available));
  });

  // The double-booking guard. A night someone is staying in must never be
  // reported as sellable - this is the exact failure the booking-matching fix
  // in listing-match.ts also protects against, from the other direction.
  test("a stay closes the nights it occupies", () => {
    const days = materializeRates(90, [], [], TUE, NEXT_TUE, [
      { checkIn: d("2026-09-02"), checkOut: d("2026-09-04") },
    ]);
    const state = (iso: string) => days.find((x) => x.date === iso)!.available;
    assert.equal(state("2026-09-01"), true, "before arrival");
    assert.equal(state("2026-09-02"), false, "first night");
    assert.equal(state("2026-09-03"), false, "second night");
    assert.equal(state("2026-09-04"), true, "checkout day is sellable again");
  });

  test("a stay overlapping the window start still closes its nights", () => {
    const days = materializeRates(90, [], [], TUE, NEXT_TUE, [
      { checkIn: d("2026-08-30"), checkOut: d("2026-09-02") },
    ]);
    assert.equal(days.find((x) => x.date === "2026-09-01")!.available, false);
    assert.equal(days.find((x) => x.date === "2026-09-02")!.available, true);
  });

  test("a calendar block closes nights, end-exclusive", () => {
    const days = materializeRates(
      90,
      [],
      [{ startDate: d("2026-09-02"), endDate: d("2026-09-04") }],
      TUE,
      NEXT_TUE
    );
    const state = (iso: string) => days.find((x) => x.date === iso)!.available;
    assert.equal(state("2026-09-02"), false);
    assert.equal(state("2026-09-03"), false);
    assert.equal(state("2026-09-04"), true, "block end is exclusive in the materializer");
  });

  test("a closed night still carries its price", () => {
    const days = materializeRates(90, [rule({ price: 140 })], [], TUE, NEXT_TUE, [
      { checkIn: d("2026-09-02"), checkOut: d("2026-09-03") },
    ]);
    const night = days.find((x) => x.date === "2026-09-02")!;
    assert.equal(night.available, false);
    assert.equal(night.price, 140, "price is resolved independently of availability");
  });
});
