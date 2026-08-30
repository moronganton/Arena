import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupContiguousDates, addDayKey } from "./date-ranges";

describe("groupContiguousDates", () => {
  test("a single date is a one-day range", () => {
    assert.deepEqual(groupContiguousDates(["2026-09-07"]), [{ start: "2026-09-07", end: "2026-09-07" }]);
  });

  test("adjacent dates collapse into one range", () => {
    assert.deepEqual(groupContiguousDates(["2026-09-07", "2026-09-08", "2026-09-09"]), [
      { start: "2026-09-07", end: "2026-09-09" },
    ]);
  });

  // The motivating case: every weekend of a month clicked individually
  // becomes one two-day rule per weekend, not eight one-day rules.
  test("weekends become one range per pair", () => {
    assert.deepEqual(
      groupContiguousDates(["2026-09-04", "2026-09-05", "2026-09-11", "2026-09-12", "2026-09-18", "2026-09-19"]),
      [
        { start: "2026-09-04", end: "2026-09-05" },
        { start: "2026-09-11", end: "2026-09-12" },
        { start: "2026-09-18", end: "2026-09-19" },
      ]
    );
  });

  test("input order and duplicates do not matter", () => {
    assert.deepEqual(groupContiguousDates(["2026-09-08", "2026-09-07", "2026-09-08"]), [
      { start: "2026-09-07", end: "2026-09-08" },
    ]);
  });

  // Click-selection spanning a month boundary must still read the calendar,
  // not string arithmetic: Sep 30 and Oct 1 are adjacent days.
  test("contiguity is judged across month boundaries", () => {
    assert.deepEqual(groupContiguousDates(["2026-09-30", "2026-10-01"]), [
      { start: "2026-09-30", end: "2026-10-01" },
    ]);
  });

  test("empty input yields no ranges", () => {
    assert.deepEqual(groupContiguousDates([]), []);
  });
});

describe("addDayKey", () => {
  it("moves to the next day", () => {
    assert.equal(addDayKey("2026-11-22"), "2026-11-23");
  });

  it("crosses a month boundary", () => {
    assert.equal(addDayKey("2026-11-30"), "2026-12-01");
  });

  it("crosses a year boundary", () => {
    assert.equal(addDayKey("2026-12-31"), "2027-01-01");
  });

  it("handles a leap day", () => {
    assert.equal(addDayKey("2028-02-28"), "2028-02-29");
    assert.equal(addDayKey("2028-02-29"), "2028-03-01");
  });

  it("turns a selection's last night into a half-open range end", () => {
    // A one-night selection is a range of exactly one night, not zero.
    const [range] = groupContiguousDates(["2026-11-22"]);
    assert.equal(range.start, "2026-11-22");
    assert.equal(addDayKey(range.end), "2026-11-23");
  });
});
