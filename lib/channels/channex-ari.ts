import { prisma } from "@/lib/prisma";
import { channexPost } from "./channex-core";
import { materializeRates, PricingRuleLike, CalendarBlockLike } from "./rate-materializer";

// Pushes the FULL current truth (availability, stop_sell, rate, min stay)
// for every date in range - deliberately not just the field(s) implied by
// whichever AriOutbox row(s) triggered this, for a reason confirmed against
// the real API: stop_sell defaults to true on a date that has never been
// touched, and stays whatever it was last set to otherwise. A push that
// only sent `rate` for a RATE-kind row would leave the date closed forever
// even with a price on it. Sending everything every time costs nothing
// extra - Channex takes it all in one flat object per date - and removes
// that failure mode entirely. AriOutbox.kind is kept for observability, not
// as a filter on what gets sent.
//
export interface RestrictionValue {
  property_id: string;
  room_type_id: string;
  rate_plan_id: string;
  date: string;
  availability: number;
  stop_sell: boolean;
  rate: number; // minor units (cents)
  min_stay_arrival: number;
}

// The DB-reading, materializing, field-mapping half - split out from the
// network call so it is testable against a real database without ever
// touching Channex (the send path itself is already proven via the
// sandbox probe, so this is the half actually worth testing in isolation).
//
// rate is converted to minor units (cents) here - confirmed empirically:
// writing rate: 55 read back as "0.55", writing 5500 read back as "55.00".
export async function buildAriValues(
  propertyId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<RestrictionValue[]> {
  const [listing, property, rules, blocks] = await Promise.all([
    prisma.channexListing.findUnique({ where: { propertyId } }),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { basePrice: true } }),
    prisma.pricingRule.findMany({ where: { propertyId, active: true } }),
    prisma.calendarBlock.findMany({ where: { propertyId } }),
  ]);
  if (!listing) throw new Error(`buildAriValues: no ChannexListing for property ${propertyId}`);

  const days = materializeRates(
    property.basePrice,
    rules as PricingRuleLike[],
    blocks as CalendarBlockLike[],
    dateFrom,
    dateTo
  );

  return days.map((d) => ({
    property_id: listing.channexPropertyId,
    room_type_id: listing.channexRoomTypeId,
    rate_plan_id: listing.channexRatePlanId,
    date: d.date,
    availability: d.available ? 1 : 0,
    // A host-blocked date must also be closed for sale, not merely show 0
    // available rooms - confirmed this is a distinct field, not implied by
    // availability alone.
    stop_sell: !d.available,
    rate: Math.round(d.price * 100),
    min_stay_arrival: d.minStay,
  }));
}

export async function pushAriForDateRange(propertyId: string, dateFrom: Date, dateTo: Date): Promise<void> {
  const values = await buildAriValues(propertyId, dateFrom, dateTo);
  if (values.length === 0) return;

  // Confirmed via the sandbox probe: this returns [{ id, type: "task" }]
  // and processes asynchronously - the caller does not get inline
  // confirmation that the write applied, only that Channex accepted it.
  await channexPost("/restrictions", { values });
}
