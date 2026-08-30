import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pricedValues, type RestrictionValue } from "./channex-ari";

// buildAriValues itself reads the database, so what is asserted here is the
// shape of what it produces - the part certification actually inspects, and
// the part that decides whether a derived plan honours a blocked date.
function value(over: Partial<RestrictionValue>): RestrictionValue {
  return {
    property_id: "prop",
    room_type_id: "room",
    rate_plan_id: "parent",
    date: "2026-11-22",
    availability: 1,
    stop_sell: false,
    rate: 33300,
    min_stay_arrival: 1,
    ...over,
  };
}

describe("pricedValues", () => {
  it("keeps one row per date when several plans share it", () => {
    const rows = [
      value({ rate_plan_id: "parent", rate: 33300 }),
      value({ rate_plan_id: "nonref", rate: undefined }),
      value({ rate_plan_id: "weekly", rate: undefined }),
    ];
    const priced = pricedValues(rows);
    assert.equal(priced.length, 1);
    assert.equal(priced[0].rate_plan_id, "parent");
  });

  it("narrows the type so rate is no longer optional", () => {
    const priced = pricedValues([value({})]);
    // Reading .rate without a guard is the point of the narrowing.
    assert.equal(priced[0].rate / 100, 333);
  });

  it("returns nothing when no row carries a price", () => {
    assert.deepEqual(pricedValues([value({ rate: undefined })]), []);
  });

  it("keeps one row per date across a range", () => {
    const rows: RestrictionValue[] = [];
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
      rows.push(value({ date: d, rate_plan_id: "parent" }));
      rows.push(value({ date: d, rate_plan_id: "nonref", rate: undefined }));
    }
    assert.deepEqual(
      pricedValues(rows).map((v) => v.date),
      ["2026-11-01", "2026-11-02", "2026-11-03"]
    );
  });
});
