// Resolving an incoming Channex booking to the StayHQ listing it belongs to.
//
// Pure functions only - no Prisma, no network - so the rule that decides
// whether a real guest's booking gets recorded is testable in isolation,
// without a database. Same reasoning as rate-materializer.ts.

// Which StayHQ listing a booked room belongs to.
//
// A booking arrives against whichever RATE PLAN the guest actually bought -
// Standard, Weekly, Non-refundable - but every rate plan on a room type sells
// the SAME physical unit. So the room type is what identifies the listing; the
// rate plan only says what the guest paid.
//
// This used to additionally require rate_plan_id === listing.channexRatePlanId.
// That holds only while a property has exactly one rate plan, which is what
// StayHQ provisions today. The moment a derived rate plan exists on Channex - a
// weekly rate at -15%, a non-refundable at -5%, the ordinary multi-plan setup
// nearly every Booking.com property runs - a booking on one of those children
// carries the CHILD's rate_plan_id, matched nothing, and was skipped.
// channex-revisions.ts then acknowledges the revision anyway (deliberately: an
// unmappable booking must not redeliver forever), so the stay was dropped
// silently: no Reservation, the nights never became occupied, and the next ARI
// push reported them available again. A confirmed guest, and the room back on
// sale on every channel.
//
// Channex's own model draws this same line - availability is tracked per ROOM
// TYPE, while price and restrictions live per rate plan - so "which unit is
// occupied" is a room-type question by construction.
//
// Room type ids are unique per property and ChannexListing.propertyId is
// unique, so this lookup stays 1:1.
export function findListingForRoomType<T extends { channexRoomTypeId: string }>(
  listings: T[],
  roomTypeId: string
): T | undefined {
  return listings.find((l) => l.channexRoomTypeId === roomTypeId);
}
