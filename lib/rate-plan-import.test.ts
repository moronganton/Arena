import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExtraction, suggestMinStay, reviewProblems, mergeExtractionIntoPlans,
  type ImportedPlan,
} from "./rate-plan-import";

describe("suggestMinStay", () => {
  test("reads the intent out of conventional names", () => {
    assert.equal(suggestMinStay("Weekly Rate").minStay, 7);
    assert.equal(suggestMinStay("Monthly Rate").minStay, 28);
    assert.equal(suggestMinStay("2 Day Rate").minStay, 2);
    assert.equal(suggestMinStay("1 Day Non-refundable").minStay, 1);
  });

  test("falls back to one night, and says it had no reason", () => {
    const s = suggestMinStay("Standard Rate");
    assert.equal(s.minStay, 1);
    assert.equal(s.reason, null);
  });

  test("an implausible number in a name is not taken as a minimum", () => {
    assert.equal(suggestMinStay("Rate 2019 Legacy").minStay, 1);
  });
});

describe("normalizeExtraction", () => {
  // The real shape, from the operator's own Booking.com screenshot.
  const BDC = [
    { title: "Standard Rate", isStandard: true, cancellationPolicy: "Flexible - 1 day", readMinStay: false },
    { title: "Non-refundable Rate", percentOfStandard: "10% cheaper than Standard Rate", cancellationPolicy: "Non-refundable", readMinStay: false },
    { title: "Weekly Rate", percentOfStandard: "15% cheaper than Standard Rate", cancellationPolicy: "Flexible - 1 day", readMinStay: false },
  ];

  test("reads the operator's real screenshot into a creatable family", () => {
    const r = normalizeExtraction(BDC);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(
      r.plans.map((p) => [p.title, p.derivedPercent, p.minStayArrival]),
      [
        ["Standard Rate", null, 1],
        ["Non-refundable Rate", -10, 1],
        ["Weekly Rate", -15, 7],
      ]
    );
  });

  // "10% cheaper than Standard Rate" is prose, and the sign is carried by the
  // word "cheaper" rather than a minus.
  test("prose discounts become negative percentages", () => {
    const r = normalizeExtraction([
      { title: "Standard", isStandard: true },
      { title: "NR", percentOfStandard: "10% cheaper than Standard Rate" },
      { title: "Peak", percentOfStandard: "20% more expensive" },
    ]);
    assert.equal(r.plans[1].derivedPercent, -10);
    assert.equal(r.plans[2].derivedPercent, 20);
  });

  // The bug this whole module exists to prevent: presenting an invented
  // minimum as though the screenshot contained one.
  test("an unread minimum is flagged as a suggestion, not a reading", () => {
    const r = normalizeExtraction([{ title: "Weekly Rate", isStandard: true, readMinStay: false }]);
    assert.equal(r.plans[0].minStayArrival, 7);
    assert.equal(r.plans[0].minStayWasRead, false);
    assert.ok(r.warnings.some((w) => w.includes("Check it")), "the operator is told to check it");
  });

  test("a minimum that WAS visible is taken as read and not warned about", () => {
    const r = normalizeExtraction([{ title: "Weekly Rate", isStandard: true, minStay: 5, readMinStay: true }]);
    assert.equal(r.plans[0].minStayArrival, 5);
    assert.equal(r.plans[0].minStayWasRead, true);
    assert.equal(r.warnings.length, 0);
  });

  test("the parent is moved first, because children cannot be created before it", () => {
    const r = normalizeExtraction([
      { title: "Weekly", percentOfStandard: -15 },
      { title: "Standard", isStandard: true },
    ]);
    assert.equal(r.plans[0].title, "Standard");
    assert.deepEqual(r.problems, []);
  });

  test("a 0% child is treated as the parent, not a duplicate of it", () => {
    const r = normalizeExtraction([{ title: "Standard", percentOfStandard: 0 }]);
    assert.equal(r.plans[0].derivedPercent, null);
  });

  describe("sets that cannot be built are refused, not half-created", () => {
    test("no parent at all", () => {
      const r = normalizeExtraction([
        { title: "A", percentOfStandard: -10 },
        { title: "B", percentOfStandard: -20 },
      ]);
      assert.ok(r.problems.some((p) => p.includes("main rate")));
    });

    test("two candidates for the parent", () => {
      const r = normalizeExtraction([
        { title: "Standard", isStandard: true },
        { title: "Rack Rate", isStandard: true },
      ]);
      assert.ok(r.problems.some((p) => p.includes("cannot tell which")));
    });

    test("duplicate titles - Channex rejects these with a 422", () => {
      const r = normalizeExtraction([
        { title: "Standard", isStandard: true },
        { title: "standard", percentOfStandard: -10 },
      ]);
      assert.ok(r.problems.length > 0);
    });

    test("a discount that would price the room at zero", () => {
      const r = normalizeExtraction([
        { title: "Standard", isStandard: true },
        { title: "Free", percentOfStandard: -100 },
      ]);
      assert.ok(r.problems.some((p) => p.includes("at or below zero")));
    });
  });

  test("cancellation policies are surfaced rather than silently dropped", () => {
    const r = normalizeExtraction(BDC);
    assert.equal(r.plans[1].cancellationPolicy, "Non-refundable");
    assert.ok(r.warnings.some((w) => w.includes("cannot store them yet")));
  });

  test("an unreadable image is a problem, not an empty success", () => {
    for (const input of [[], null, "nonsense", {}]) {
      const r = normalizeExtraction(input);
      assert.equal(r.plans.length, 0);
      assert.ok(r.problems.length > 0, JSON.stringify(input));
    }
  });

  test("a nameless row is skipped with a note, not silently", () => {
    const r = normalizeExtraction([{ title: "Standard", isStandard: true }, { percentOfStandard: -10 }]);
    assert.equal(r.plans.length, 1);
    assert.ok(r.warnings.some((w) => w.includes("no readable name")));
  });
});

describe("reviewProblems", () => {
  const base = { cancellationPolicy: null, minStayWasRead: true };
  const parent = { ...base, title: "Standard Rate", derivedPercent: null, minStayArrival: 3 };

  it("blocks on a child whose percentage the channel never supplied", () => {
    const problems = reviewProblems([
      parent,
      { ...base, title: "Non-Refundable Rate", derivedPercent: null, minStayArrival: 3, needsPercent: true },
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Non-Refundable Rate/);
    assert.match(problems[0], /Enter the percentage/);
  });

  it("names the real parent in that message rather than a placeholder", () => {
    const problems = reviewProblems([
      { ...parent, title: "Flexible Rate" },
      { ...base, title: "NR", derivedPercent: null, minStayArrival: 1, needsPercent: true },
    ]);
    assert.match(problems[0], /"Flexible Rate"/);
  });

  it("does not also complain about two parents while a percentage is pending", () => {
    const problems = reviewProblems([
      parent,
      { ...base, title: "NR", derivedPercent: null, minStayArrival: 1, needsPercent: true },
    ]);
    assert.ok(!problems.some((p) => /cannot tell which is your main rate/.test(p)));
  });

  it("clears once the operator supplies the number", () => {
    assert.deepEqual(
      reviewProblems([
        parent,
        { ...base, title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 3, needsPercent: true },
      ]),
      []
    );
  });

  it("still catches structural faults once nothing is pending", () => {
    const problems = reviewProblems([
      parent,
      { ...base, title: "Standard Rate", derivedPercent: -10, minStayArrival: 3 },
    ]);
    assert.ok(problems.some((p) => /unique/.test(p)));
  });

  it("an empty set is blocking", () => {
    assert.equal(reviewProblems([]).length, 1);
  });
});

describe("mergeExtractionIntoPlans", () => {
  const base = { cancellationPolicy: null, minStayWasRead: false };
  // What a channel read produces: exact names, no numbers at all.
  const fromChannel: ImportedPlan[] = [
    { ...base, title: "Standard Rate", derivedPercent: null, minStayArrival: 1, needsPercent: false },
    { ...base, title: "Non-Refundable Rate", derivedPercent: null, minStayArrival: 1, needsPercent: true },
    { ...base, title: "Partial Refund Rate", derivedPercent: null, minStayArrival: 1, needsPercent: true },
  ];

  it("fills the percentages the channel could not give", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
      { title: "Partial Refund Rate", derivedPercent: -5, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
    ]);
    assert.equal(r.plans[1].derivedPercent, -10);
    assert.equal(r.plans[1].needsPercent, false);
    assert.equal(r.plans[2].derivedPercent, -5);
    assert.deepEqual(r.stillMissing, []);
  });

  it("matches across casing and punctuation differences", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "non refundable rate", derivedPercent: -10, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
    ]);
    assert.equal(r.plans[1].derivedPercent, -10);
  });

  it("never invents a plan the channel did not list", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Weekly Rate", derivedPercent: -15, minStayArrival: 7, cancellationPolicy: null, minStayWasRead: true },
    ]);
    assert.equal(r.plans.length, 3);
    assert.deepEqual(r.unmatched, ["Weekly Rate"]);
  });

  it("takes a minimum stay only when the screenshot genuinely read one", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 9, cancellationPolicy: null, minStayWasRead: false },
    ]);
    // A suggestion replacing a suggestion is not an improvement.
    assert.equal(r.plans[1].minStayArrival, 1);
    assert.equal(r.plans[1].minStayWasRead, false);
  });

  it("takes a minimum stay that WAS read", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 4, cancellationPolicy: null, minStayWasRead: true },
    ]);
    assert.equal(r.plans[1].minStayArrival, 4);
    assert.equal(r.plans[1].minStayWasRead, true);
  });

  it("refuses to give the parent a percentage, whatever the screenshot says", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Standard Rate", derivedPercent: -20, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
    ]);
    assert.equal(r.plans[0].derivedPercent, null);
    assert.equal(r.plans[0].needsPercent, false);
  });

  it("reports what is still unanswered after the merge", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
    ]);
    assert.deepEqual(r.stillMissing, ["Partial Refund Rate"]);
  });

  it("carries a cancellation policy across", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 1, cancellationPolicy: "Non-refundable", minStayWasRead: false },
    ]);
    assert.equal(r.plans[1].cancellationPolicy, "Non-refundable");
  });

  it("a duplicated name in the screenshot does not silently pick the second", () => {
    const r = mergeExtractionIntoPlans(fromChannel, [
      { title: "Non-Refundable Rate", derivedPercent: -10, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
      { title: "Non-Refundable Rate", derivedPercent: -40, minStayArrival: 1, cancellationPolicy: null, minStayWasRead: false },
    ]);
    assert.equal(r.plans[1].derivedPercent, -10);
  });
});
