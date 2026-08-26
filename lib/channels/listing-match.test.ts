import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findListingForRoomType } from "./listing-match";

// The listing shape this function actually depends on. Deliberately minimal -
// the real ChannexListing carries a dozen more columns, none of which this
// decision may ever start reading without a test saying so.
const SINTEU = {
  id: "listing-sinteu",
  channexRoomTypeId: "rt-sinteu",
  channexRatePlanId: "rp-sinteu-standard",
};
const BRATISLAVA = {
  id: "listing-bratislava",
  channexRoomTypeId: "rt-bratislava",
  channexRatePlanId: "rp-bratislava-standard",
};
const LISTINGS = [SINTEU, BRATISLAVA];

// The two fields of an incoming booking room that identify what was sold.
// Tests resolve through this rather than passing a room type id directly, so
// they exercise the call site's actual decision - given both ids, which one
// decides the listing.
type BookedRoom = { room_type_id: string; rate_plan_id: string };
const resolve = (room: BookedRoom) => findListingForRoomType(LISTINGS, room.room_type_id);

describe("findListingForRoomType", () => {
  test("matches a booking on the listing's own rate plan", () => {
    assert.equal(resolve({ room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-standard" }), SINTEU);
  });

  // The regression this function exists for. Matching used to require
  // rate_plan_id === listing.channexRatePlanId, so a booking on ANY derived
  // plan resolved to nothing, was skipped, and was then acknowledged as
  // unmappable - losing a confirmed stay and leaving its nights on sale.
  //
  // The fix is structural: rate_plan_id is no longer an input to the decision,
  // so it cannot narrow the match again without changing this signature and
  // these tests together.
  test("matches a booking that arrived on a DERIVED rate plan", () => {
    // Weekly Rate: Standard -15%, min LOS 7. Its id is one StayHQ has never
    // stored, because Channex created it, not us.
    const weekly: BookedRoom = { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-weekly" };
    assert.equal(resolve(weekly), SINTEU, "a derived-plan booking must resolve to its room type's listing");
  });

  test("all six rate plans on one room type resolve to the same listing", () => {
    // The real shape of a Booking.com property: one apartment, six products.
    const rooms: BookedRoom[] = [
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-standard" },
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-nonref" }, // -5%
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-weekly" }, // -15%, min 7
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-monthly" }, // -25%, min 28
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-2day" }, // +20%, min 2
      { room_type_id: "rt-sinteu", rate_plan_id: "rp-sinteu-1day" }, // +60%, min 1
    ];
    assert.deepEqual(
      rooms.map(resolve),
      rooms.map(() => SINTEU),
      "six plans sell one physical unit and must all map to one listing"
    );
  });

  test("a derived plan on another property still resolves to that property", () => {
    const room: BookedRoom = { room_type_id: "rt-bratislava", rate_plan_id: "rp-bratislava-weekly" };
    assert.equal(resolve(room), BRATISLAVA, "the room type, not the plan, decides the property");
  });

  test("keeps two properties apart", () => {
    assert.equal(findListingForRoomType(LISTINGS, "rt-bratislava"), BRATISLAVA);
  });

  test("returns undefined for a room type we do not own", () => {
    // Channex's sandbox hotel is shared between integrators; another tester's
    // room must not resolve to one of ours.
    assert.equal(findListingForRoomType(LISTINGS, "rt-someone-elses"), undefined);
  });

  test("returns undefined when there are no listings", () => {
    assert.equal(findListingForRoomType([], "rt-sinteu"), undefined);
  });

  // A rate plan id must never be able to act as a room type id by accident.
  test("does not match a room type id against a rate plan id", () => {
    assert.equal(findListingForRoomType(LISTINGS, "rp-sinteu-standard"), undefined);
  });
});
