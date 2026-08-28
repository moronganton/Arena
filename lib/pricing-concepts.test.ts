import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRule,
  describeRule,
  parseDays,
  PRIORITY,
  toDateInput,
  type RuleLike,
} from "./pricing-concepts";

function rule(over: Partial<RuleLike> = {}): RuleLike {
  return {
    name: "A rule",
    startDate: null,
    endDate: null,
    daysOfWeek: null,
    price: null,
    adjustment: null,
    priority: 0,
    ...over,
  };
}

describe("classifyRule", () => {
  test("the property's floor is the base", () => {
    assert.equal(classifyRule(rule({ name: "Full year base rate", price: 100 })), "BASE");
  });

  test("a named date range with a price is a season", () => {
    assert.equal(
      classifyRule(rule({ name: "Summer", startDate: "2026-06-01", endDate: "2026-08-31", price: 150 })),
      "SEASON"
    );
  });

  test("a day-scoped percentage is the weekend concept", () => {
    assert.equal(classifyRule(rule({ daysOfWeek: "[5,6]", adjustment: 18 })), "WEEKEND");
  });

  // An operator whose weekend is Sat/Sun still means "weekends" - classifying
  // by the specific days would exile them to the advanced drawer for holding a
  // different opinion about which days a weekend is.
  test("any day scoping counts, not just Fri/Sat", () => {
    assert.equal(classifyRule(rule({ daysOfWeek: "[6,0]", adjustment: 25 })), "WEEKEND");
    assert.equal(classifyRule(rule({ daysOfWeek: "[1]", adjustment: -10 })), "WEEKEND");
  });

  test("calendar overrides are recognised by their name prefix", () => {
    assert.equal(
      classifyRule(rule({ name: "[manual] 2026-09-07 to 2026-09-07", startDate: "2026-09-07", endDate: "2026-09-07", price: 150 })),
      "OVERRIDE"
    );
  });

  // The materializer never reads ruleType, and rules predating this vocabulary
  // carry whatever the old dropdown happened to be on - so shape decides.
  test("classification ignores the decorative ruleType entirely", () => {
    const seasonShaped = rule({ name: "Winter", startDate: "2026-12-01", endDate: "2027-01-05", price: 200 });
    assert.equal(classifyRule(seasonShaped), "SEASON");
  });

  test("all seven days selected is not a weekend rule", () => {
    assert.equal(classifyRule(rule({ daysOfWeek: "[0,1,2,3,4,5,6]", adjustment: 10 })), "CUSTOM");
  });

  test("shapes that fit no concept stay custom rather than being mislabelled", () => {
    // A date range expressed as a percentage: legal, honoured by the engine,
    // but a season form whose only field is a price cannot represent it.
    assert.equal(
      classifyRule(rule({ startDate: "2026-06-01", endDate: "2026-08-31", adjustment: 12 })),
      "CUSTOM"
    );
    // A rule with neither a price nor an adjustment does nothing to price.
    assert.equal(classifyRule(rule({ startDate: "2026-06-01" })), "CUSTOM");
  });
});

describe("parseDays", () => {
  test("reads a stored day array", () => {
    assert.deepEqual(parseDays("[5,6]"), [5, 6]);
  });

  test("malformed JSON yields null rather than throwing", () => {
    assert.equal(parseDays("not json"), null);
    assert.equal(parseDays('["Friday"]'), null);
    assert.equal(parseDays(null), null);
  });
});

describe("toDateInput", () => {
  test("trims an ISO timestamp to a date input's format", () => {
    assert.equal(toDateInput("2026-06-01T00:00:00.000Z"), "2026-06-01");
    assert.equal(toDateInput(new Date("2026-06-01T00:00:00.000Z")), "2026-06-01");
  });

  test("an open bound is an empty field", () => {
    assert.equal(toDateInput(null), "");
  });
});

describe("describeRule", () => {
  test("states a flat price and its range", () => {
    assert.equal(
      describeRule(rule({ startDate: "2026-06-01", endDate: "2026-08-31", price: 150 }), "EUR"),
      "EUR 150 · 2026-06-01 to 2026-08-31"
    );
  });

  test("states a percentage and the days it lands on", () => {
    assert.equal(describeRule(rule({ daysOfWeek: "[5,6]", adjustment: 18 }), "EUR"), "+18% · Fri Sat · every night");
  });

  test("a rule with no dates says so rather than showing blanks", () => {
    assert.equal(describeRule(rule({ price: 100 }), "EUR"), "EUR 100 · every night");
  });
});

describe("PRIORITY", () => {
  // The operator never sees these, but the order between them is the whole
  // contract: a weekend inside a season must beat the season, and a date the
  // operator clicked must beat both.
  test("stacks base < season < weekend < override", () => {
    assert.ok(PRIORITY.BASE < PRIORITY.SEASON);
    assert.ok(PRIORITY.SEASON < PRIORITY.WEEKEND);
    assert.ok(PRIORITY.WEEKEND < PRIORITY.OVERRIDE);
  });

  test("the override tier matches what the calendar actually writes", () => {
    assert.equal(PRIORITY.OVERRIDE, 50);
  });
});
