import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectReconcileCandidates, type WebhookLogRow } from "./booking-reconcile";

const OURS = "31192fed-7d00-47f2-8158-eb2488c61331";
const THEIRS = "00000000-0000-0000-0000-000000000000";
const NOW = new Date("2026-08-30T18:00:00.000Z");

function row(over: Partial<WebhookLogRow> & { revisionId?: string; propertyId?: string }): WebhookLogRow {
  const { revisionId = "rev-1", propertyId = OURS, ...rest } = over;
  return {
    id: "log-1",
    createdAt: new Date("2026-08-30T17:00:00.000Z"),
    reservationId: null,
    payload: JSON.stringify({
      event: "booking",
      payload: { property_id: propertyId, booking_id: "b1", revision_id: revisionId },
    }),
    ...rest,
  };
}

describe("selectReconcileCandidates", () => {
  it("picks up a recent delivery that never became a reservation", () => {
    const got = selectReconcileCandidates([row({})], new Set([OURS]), NOW);
    assert.deepEqual(got, [{ logId: "log-1", revisionId: "rev-1", propertyId: OURS }]);
  });

  it("leaves alone anything that already landed", () => {
    const got = selectReconcileCandidates([row({ reservationId: "res-1" })], new Set([OURS]), NOW);
    assert.deepEqual(got, []);
  });

  it("ignores bookings for properties we do not manage", () => {
    // The Booking.com sandbox hotels are shared between testers.
    const got = selectReconcileCandidates([row({ propertyId: THEIRS })], new Set([OURS]), NOW);
    assert.deepEqual(got, []);
  });

  it("stops retrying once the window has passed", () => {
    const old = row({ createdAt: new Date("2026-08-27T17:00:00.000Z") });
    assert.deepEqual(selectReconcileCandidates([old], new Set([OURS]), NOW), []);
    // Still inside a wider window, so the bound is the window and not the row.
    assert.equal(selectReconcileCandidates([old], new Set([OURS]), NOW, 96).length, 1);
  });

  it("retries a revision once per sweep, however often it was delivered", () => {
    const got = selectReconcileCandidates(
      [row({ id: "a" }), row({ id: "b" })],
      new Set([OURS]),
      NOW
    );
    assert.equal(got.length, 1);
  });

  it("caps a sweep, leaving the rest for the next one", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `log-${i}`, revisionId: `rev-${i}` }));
    assert.equal(selectReconcileCandidates(rows, new Set([OURS]), NOW).length, 25);
    assert.equal(selectReconcileCandidates(rows, new Set([OURS]), NOW, 48, 5).length, 5);
  });

  it("skips a body it cannot read rather than throwing", () => {
    const bad = { ...row({}), payload: "not json" };
    const missing = { ...row({ id: "m" }), payload: JSON.stringify({ payload: {} }) };
    assert.deepEqual(selectReconcileCandidates([bad, missing], new Set([OURS]), NOW), []);
  });

  it("an empty account selects nothing", () => {
    assert.deepEqual(selectReconcileCandidates([row({})], new Set(), NOW), []);
  });
});
