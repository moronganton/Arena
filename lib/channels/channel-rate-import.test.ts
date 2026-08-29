import { test } from "node:test";
import assert from "node:assert/strict";
import { readChannelRatePlans, pickParentIndex, titleCase, channelDisplayName } from "./channel-rate-import";

// The exact body POST /channels/mapping_details returned for a live
// Booking.com connection. Captured rather than imagined, because every
// assumption this module makes about Booking.com's shape is an assumption
// about someone's real listing.
const LIVE_BOOKING_PAYLOAD = {
  rooms: [
    {
      id: 1074503007,
      title: "Holiday Home",
      max_children: null,
      rates: [
        {
          id: 39950621,
          title: "standard rate",
          readonly: false,
          derived_rate_plan_ids: [39950631],
          occupancies: [],
          price_1: false,
          pricing: "Standard",
          max_persons: 11,
          parent_rate_id: "",
        },
        {
          id: 39950622,
          title: "non-refundable rate",
          readonly: false,
          occupancies: [],
          price_1: false,
          pricing: "Standard",
          max_persons: 11,
          parent_rate_id: "",
        },
      ],
    },
    {
      id: 1074503008,
      title: "Studio",
      max_children: null,
      rates: [
        {
          id: 39950621,
          title: "standard rate",
          readonly: false,
          occupancies: [],
          price_1: false,
          pricing: "Standard",
          max_persons: 2,
          parent_rate_id: "",
        },
      ],
    },
  ],
  pricing_type: "Standard",
};

test("reads the live Booking.com payload into rooms and plans", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  assert.equal(r.problems.length, 0);
  assert.equal(r.rooms.length, 2);
  assert.deepEqual(
    r.rooms.map((x) => x.title),
    ["Holiday Home", "Studio"]
  );
  assert.deepEqual(
    r.rooms[0].plans.map((p) => p.title),
    ["Standard Rate", "Non-Refundable Rate"]
  );
  assert.deepEqual(
    r.rooms[0].plans.map((p) => p.channelRateId),
    ["39950621", "39950622"]
  );
});

test("the rate the channel says has children becomes the parent", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  const [parent, child] = r.rooms[0].plans;
  assert.equal(parent.needsPercent, false);
  assert.equal(parent.derivedPercent, null);
  assert.equal(child.needsPercent, true);
});

test("no percentage is ever invented - the child is blocked on a human", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  for (const p of r.rooms[0].plans) assert.equal(p.derivedPercent, null);
  assert.equal(r.rooms[0].plans[1].needsPercent, true);
});

test("no minimum stay is ever claimed as read - mapping_details carries none", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  for (const room of r.rooms) for (const p of room.plans) assert.equal(p.minStayWasRead, false);
});

test("a derived plan the channel names but does not describe is reported", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  // 39950631 is referenced by standard rate and appears nowhere in the payload.
  assert.ok(r.warnings.some((w) => w.includes("39950631")));
});

test("more room types than host24 models is a warning, not a silent pick", () => {
  const r = readChannelRatePlans(LIVE_BOOKING_PAYLOAD);
  assert.ok(r.warnings.some((w) => w.includes("2 room types")));
});

test("the parent is first, so nothing derives from a plan not yet created", () => {
  const r = readChannelRatePlans({
    rooms: [
      {
        id: 1,
        title: "Apartment",
        rates: [
          { id: 10, title: "weekly rate" },
          { id: 11, title: "standard rate" },
        ],
      },
    ],
  });
  assert.equal(r.rooms[0].plans[0].title, "Standard Rate");
  assert.equal(r.rooms[0].plans[0].needsPercent, false);
});

test("falls back to the first rate when nothing identifies a base plan", () => {
  assert.equal(pickParentIndex([{ title: "alpha" }, { title: "beta" }]), 0);
});

test("a named base plan beats position", () => {
  assert.equal(pickParentIndex([{ title: "weekly deal" }, { title: "flexible rate" }]), 1);
});

test("declared children beat a matching name", () => {
  assert.equal(
    pickParentIndex([
      { title: "summer rate", derived_rate_plan_ids: [99] },
      { title: "standard rate" },
    ]),
    0
  );
});

test("a minimum stay is suggested from the name and marked as a suggestion", () => {
  const r = readChannelRatePlans({
    rooms: [{ id: 1, title: "Flat", rates: [{ id: 1, title: "standard rate" }, { id: 2, title: "weekly rate" }] }],
  });
  const weekly = r.rooms[0].plans.find((p) => p.title === "Weekly Rate")!;
  assert.equal(weekly.minStayArrival, 7);
  assert.equal(weekly.minStayWasRead, false);
});

test("duplicate titles inside one room are made unique rather than colliding", () => {
  const r = readChannelRatePlans({
    rooms: [
      {
        id: 1,
        title: "Flat",
        rates: [
          { id: 1, title: "standard rate" },
          { id: 2, title: "Standard Rate" },
        ],
      },
    ],
  });
  const titles = r.rooms[0].plans.map((p) => p.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(r.warnings.some((w) => w.includes("renamed")));
});

test("the same rate id repeated in one room is one product", () => {
  const r = readChannelRatePlans({
    rooms: [{ id: 1, title: "Flat", rates: [{ id: 7, title: "standard rate" }, { id: 7, title: "standard rate" }] }],
  });
  assert.equal(r.rooms[0].plans.length, 1);
});

test("a room with no rates is reported, not silently dropped", () => {
  const r = readChannelRatePlans({
    rooms: [
      { id: 1, title: "Empty Room", rates: [] },
      { id: 2, title: "Flat", rates: [{ id: 1, title: "standard rate" }] },
    ],
  });
  assert.equal(r.rooms.length, 1);
  assert.ok(r.warnings.some((w) => w.includes("Empty Room")));
});

test("a payload with no rooms is a problem, not an empty success", () => {
  assert.ok(readChannelRatePlans({}).problems.length > 0);
  assert.ok(readChannelRatePlans(null).problems.length > 0);
  assert.ok(readChannelRatePlans({ rooms: [] }).problems.length > 0);
});

test("titles already carrying capitals are left alone", () => {
  assert.equal(titleCase("standard rate"), "Standard Rate");
  assert.equal(titleCase("BAR Rate"), "BAR Rate");
  assert.equal(titleCase("non-refundable rate"), "Non-Refundable Rate");
});

test("adapter codes are shown as the names operators know", () => {
  assert.equal(channelDisplayName("BookingCom"), "Booking.com");
  assert.equal(channelDisplayName("Airbnb"), "Airbnb");
  // Never mangled into something plausible-but-wrong.
  assert.equal(channelDisplayName("SomeNewOTA"), "SomeNewOTA");
});
