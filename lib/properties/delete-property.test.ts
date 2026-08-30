import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { propertyPurgeAllowed, hasBlockers, describeBlockers } from "./delete-property";

const none = { reservations: 0, expenses: 0, perReservationCosts: 0, damageReports: 0 };
let saved: string | undefined;

describe("propertyPurgeAllowed", () => {
  beforeEach(() => { saved = process.env.ALLOW_PROPERTY_PURGE; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_PROPERTY_PURGE;
    else process.env.ALLOW_PROPERTY_PURGE = saved;
  });

  it("is off when the variable is absent", () => {
    delete process.env.ALLOW_PROPERTY_PURGE;
    assert.equal(propertyPurgeAllowed(), false);
  });

  it("is on only for the exact string true", () => {
    process.env.ALLOW_PROPERTY_PURGE = "true";
    assert.equal(propertyPurgeAllowed(), true);
    // Anything vaguely affirmative is still off: a destructive capability
    // should not turn itself on because someone typed "yes" or "1".
    for (const v of ["1", "yes", "TRUE", "on", ""]) {
      process.env.ALLOW_PROPERTY_PURGE = v;
      assert.equal(propertyPurgeAllowed(), false, `"${v}" must not enable it`);
    }
  });
});

describe("delete blockers", () => {
  it("a property holding nothing is deletable", () => {
    assert.equal(hasBlockers(none), false);
  });

  it("any single kind of record blocks it", () => {
    for (const k of ["reservations", "expenses", "perReservationCosts", "damageReports"] as const) {
      assert.equal(hasBlockers({ ...none, [k]: 1 }), true, `${k} must block`);
    }
  });

  it("names what is holding it, in the operator's words", () => {
    assert.equal(describeBlockers({ ...none, reservations: 1 }), "1 reservation");
    assert.equal(
      describeBlockers({ ...none, reservations: 3, damageReports: 2 }),
      "3 reservations, 2 damage reports"
    );
  });
});
