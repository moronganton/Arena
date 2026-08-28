import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  connectedChannels,
  ladderLengths,
  offersForStay,
  plansOnChannel,
  type PlanLike,
} from "./channel-offers";

// The property's real family, verified live against Channex this session.
const FAMILY: PlanLike[] = [
  { title: "Standard Rate", kind: "PARENT", derivedPercent: null, minStayArrival: 4 },
  { title: "Standard Non-refundable", kind: "DERIVED", derivedPercent: -5, minStayArrival: 3 },
  { title: "Weekly Rate", kind: "DERIVED", derivedPercent: -15, minStayArrival: 7 },
  { title: "Monthly Rate", kind: "DERIVED", derivedPercent: -25, minStayArrival: 28 },
  { title: "2 Day Rate", kind: "DERIVED", derivedPercent: 20, minStayArrival: 2 },
  { title: "1 Day Non-refundable", kind: "DERIVED", derivedPercent: 60, minStayArrival: 1 },
];
const PARENT_PRICE = 100;

describe("plansOnChannel", () => {
  test("Booking.com carries the whole family", () => {
    assert.equal(plansOnChannel(FAMILY, "BOOKING").length, 6);
  });

  // The constraint the whole panel exists to make visible: Airbnb accepts one
  // rate plan per listing, so everything derived is Booking.com-only.
  test("Airbnb carries the parent alone", () => {
    const abb = plansOnChannel(FAMILY, "AIRBNB");
    assert.deepEqual(abb.map((p) => p.title), ["Standard Rate"]);
  });
});

describe("ladderLengths", () => {
  test("is one night plus every distinct minimum in the family", () => {
    assert.deepEqual(ladderLengths(FAMILY), [1, 2, 3, 4, 7, 28]);
  });

  test("a family with an unusual minimum gets its own rung", () => {
    assert.deepEqual(
      ladderLengths([{ title: "Five", kind: "DERIVED", derivedPercent: -10, minStayArrival: 5 }]),
      [1, 5]
    );
  });
});

describe("offersForStay on Booking.com", () => {
  test("one night: only the short-stay premium qualifies", () => {
    const q = offersForStay(FAMILY, PARENT_PRICE, 1, "BOOKING");
    assert.deepEqual(q.offers.map((o) => o.title), ["1 Day Non-refundable"]);
    assert.equal(q.cheapest?.price, 160);
  });

  test("two nights: the cheaper 2 Day rate beats the 1 Day premium", () => {
    const q = offersForStay(FAMILY, PARENT_PRICE, 2, "BOOKING");
    assert.equal(q.cheapest?.title, "2 Day Rate");
    assert.equal(q.cheapest?.price, 120);
  });

  // The parent is never the cheapest offer here: its non-refundable twin is
  // both cheaper and available a night sooner, which is worth seeing.
  test("four nights: non-refundable undercuts the parent", () => {
    const q = offersForStay(FAMILY, PARENT_PRICE, 4, "BOOKING");
    assert.equal(q.cheapest?.title, "Standard Non-refundable");
    assert.equal(q.cheapest?.price, 95);
    assert.ok(q.offers.some((o) => o.title === "Standard Rate"), "the parent is still offered");
  });

  test("long stays unlock the deepest discounts", () => {
    assert.equal(offersForStay(FAMILY, PARENT_PRICE, 7, "BOOKING").cheapest?.price, 85);
    assert.equal(offersForStay(FAMILY, PARENT_PRICE, 28, "BOOKING").cheapest?.price, 75);
  });

  test("offers are ordered cheapest first", () => {
    const prices = offersForStay(FAMILY, PARENT_PRICE, 28, "BOOKING").offers.map((o) => o.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  });
});

describe("offersForStay on Airbnb", () => {
  // The finding this panel is built to surface: short stays are not dearer on
  // Airbnb, they are impossible - the guest never sees the listing.
  test("a stay under the parent's minimum is not bookable at all", () => {
    for (const nights of [1, 2, 3]) {
      const q = offersForStay(FAMILY, PARENT_PRICE, nights, "AIRBNB");
      assert.equal(q.bookable, false, `${nights} nights`);
      assert.equal(q.cheapest, null);
    }
    assert.equal(offersForStay(FAMILY, PARENT_PRICE, 1, "AIRBNB").shortestStay, 4);
  });

  test("at or above the minimum, the single offer mirrors the parent at 0%", () => {
    const q = offersForStay(FAMILY, PARENT_PRICE, 7, "AIRBNB");
    assert.equal(q.offers.length, 1);
    assert.equal(q.cheapest?.price, PARENT_PRICE);
    assert.equal(q.cheapest?.derivedPercent, null);
  });

  test("Airbnb costs the guest more the longer they stay", () => {
    for (const nights of [7, 28]) {
      const abb = offersForStay(FAMILY, PARENT_PRICE, nights, "AIRBNB").cheapest!.price;
      const bdc = offersForStay(FAMILY, PARENT_PRICE, nights, "BOOKING").cheapest!.price;
      assert.ok(abb > bdc, `${nights} nights: ${abb} should exceed ${bdc}`);
    }
  });
});

describe("connectedChannels", () => {
  const PROP = "31192fed-7d00-47f2-8158-eb2488c61331";

  // The live payload names the channel "AirBNB" while the documented code is
  // ABB; both must resolve, or the panel silently claims nothing is connected.
  test("resolves the live label and the documented code alike", () => {
    assert.deepEqual(
      connectedChannels([{ channel: "AirBNB", is_active: true, properties: [PROP] }], PROP),
      ["AIRBNB"]
    );
    assert.deepEqual(
      connectedChannels([{ channel: "ABB", is_active: true, properties: [PROP] }], PROP),
      ["AIRBNB"]
    );
    assert.deepEqual(
      connectedChannels([{ channel: "BDC", is_active: true, properties: [PROP] }], PROP),
      ["BOOKING"]
    );
  });

  test("a connection covering other properties does not count for this one", () => {
    assert.deepEqual(
      connectedChannels([{ channel: "BDC", is_active: true, properties: ["someone-else"] }], PROP),
      []
    );
  });

  test("deactivated connections are excluded", () => {
    assert.deepEqual(
      connectedChannels([{ channel: "BDC", is_active: false, properties: [PROP] }], PROP),
      []
    );
  });

  test("an unrecognised channel is ignored rather than guessed at", () => {
    assert.deepEqual(
      connectedChannels([{ channel: "Expedia", is_active: true, properties: [PROP] }], PROP),
      []
    );
  });
});
