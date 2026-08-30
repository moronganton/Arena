import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messagePollFailure } from "./channex-messages";

const base = { reservationsChecked: 0, imported: 0, unsupported: 0, forbidden: 0, errors: [] as string[] };

describe("messagePollFailure", () => {
  it("a clean run is not a failure", () => {
    assert.equal(messagePollFailure({ ...base, reservationsChecked: 12, imported: 3 }), null);
  });

  it("a few dead threads alongside working ones is not a failure", () => {
    // The live case: 8 bookings whose channel was disconnected turned this
    // cron permanently red while everything else kept working.
    assert.equal(
      messagePollFailure({ ...base, reservationsChecked: 20, imported: 2, forbidden: 8 }),
      null
    );
  });

  it("bookings on an OTA without messaging are not a failure either", () => {
    assert.equal(messagePollFailure({ ...base, unsupported: 40 }), null);
  });

  it("every thread forbidden and nothing succeeding IS a failure", () => {
    const msg = messagePollFailure({ ...base, forbidden: 15 });
    assert.ok(msg);
    assert.match(msg!, /lost access/);
  });

  it("forbidden alongside an unsupported booking is not systemic", () => {
    // Something answered, so the key still works.
    assert.equal(messagePollFailure({ ...base, forbidden: 5, unsupported: 1 }), null);
  });

  it("a real error still fails the run", () => {
    const msg = messagePollFailure({ ...base, reservationsChecked: 5, errors: ["b1: boom"] });
    assert.equal(msg, "b1: boom");
  });

  it("real errors are reported ahead of forbidden counts", () => {
    const msg = messagePollFailure({ ...base, forbidden: 9, errors: ["b1: boom"] });
    assert.equal(msg, "b1: boom");
  });
});
