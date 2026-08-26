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
  const [listing, property, rules, blocks, stays] = await Promise.all([
    prisma.channexListing.findUnique({ where: { propertyId } }),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { basePrice: true } }),
    // Ordered even though resolvePrice now sorts for itself: an unordered
    // read of the rules that decide prices is the kind of thing that looks
    // harmless until it isn't.
    prisma.pricingRule.findMany({
      where: { propertyId, active: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    prisma.calendarBlock.findMany({ where: { propertyId } }),
    // Nights already sold. Cancelled stays are excluded, which is exactly what
    // frees those nights again the moment a guest cancels - no separate
    // release step, the next push simply reports them available.
    //
    // Overlap, not containment: a stay that started before this window and
    // ends inside it still occupies part of it.
    prisma.reservation.findMany({
      where: {
        propertyId,
        status: { not: "CANCELLED" },
        checkIn: { lt: dateTo },
        checkOut: { gt: dateFrom },
      },
      select: { checkIn: true, checkOut: true },
    }),
  ]);
  if (!listing) throw new Error(`buildAriValues: no ChannexListing for property ${propertyId}`);

  const days = materializeRates(
    property.basePrice,
    rules as PricingRuleLike[],
    blocks as CalendarBlockLike[],
    dateFrom,
    dateTo,
    stays
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

export interface AvailabilityValue {
  property_id: string;
  room_type_id: string;
  date: string;
  availability: number;
}

// POST /restrictions has no `availability` field in its real documented
// schema (confirmed by reading docs.channex.io/api-v.1-documentation/ari
// directly) - availability is a distinct concept, read and written at the
// ROOM TYPE level via its own endpoint, not the rate-plan-level restrictions
// one. stop_sell above already makes a full StayHQ listing (count_of_rooms:
// 1) unbookable when occupied, which is functionally equivalent for a
// one-room-per-listing model - but certification tests 9 and 10 are named
// "Availability Update" and graded on this exact endpoint, so sending only
// stop_sell left it untested.
async function buildAvailabilityValues(propertyId: string, restrictionValues: RestrictionValue[]): Promise<AvailabilityValue[]> {
  const listing = await prisma.channexListing.findUnique({ where: { propertyId }, select: { channexRoomTypeId: true } });
  if (!listing) throw new Error(`buildAvailabilityValues: no ChannexListing for property ${propertyId}`);
  return restrictionValues.map((v) => ({
    property_id: v.property_id,
    room_type_id: listing.channexRoomTypeId,
    date: v.date,
    availability: v.availability,
  }));
}

// Returns the task id(s) Channex hands back for this push. Certification's
// full-sync test asks explicitly for these: "please attach the returned
// id(s) generated by our side" - evidence that a call was actually made and
// accepted, not just that this code believes it succeeded.
//
// Two calls, not one - restrictions (rate/stop_sell/min_stay) and
// availability are separate endpoints with separate rate-limit budgets (10
// + 10 per minute per property, confirmed on the real rate-limits page), so
// making both costs nothing against the limit that a single combined call
// wouldn't already cost.
export async function pushAriForDateRange(propertyId: string, dateFrom: Date, dateTo: Date): Promise<string[]> {
  const values = await buildAriValues(propertyId, dateFrom, dateTo);
  if (values.length === 0) return [];

  // Confirmed via the sandbox probe: both endpoints return [{ id, type:
  // "task" }] and process asynchronously - the caller does not get inline
  // confirmation that the write applied, only that Channex accepted it.
  const restrictionsRes = await channexPost<Array<{ id: string; type: string }>>("/restrictions", { values });

  const availabilityValues = await buildAvailabilityValues(propertyId, values);
  const availabilityRes = await channexPost<Array<{ id: string; type: string }>>("/availability", { values: availabilityValues });

  return [...(restrictionsRes.data ?? []), ...(availabilityRes.data ?? [])].map((t) => t.id);
}

const FULL_SYNC_HORIZON_DAYS = 500; // certification's own number, not the 365-day routine-push horizon
const FULL_SYNC_CHUNK_DAYS = 100;
const FULL_SYNC_MIN_MS_BETWEEN_CALLS = 6500; // same pacing as ari-drain.ts, for the same reason

function addDaysUtc(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export interface FullSyncPropertyResult {
  propertyId: string;
  propertyName: string;
  taskIds: string[];
  callsFailed: number;
}

// Pushes the full 500-day window for one property, chunked and throttled -
// the same logic /api/channex/full-sync and the debug version both call, so
// there is exactly one implementation of "what a full sync does."
export async function runFullSyncForProperty(propertyId: string, propertyName: string): Promise<FullSyncPropertyResult> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = addDaysUtc(from, FULL_SYNC_HORIZON_DAYS);

  const taskIds: string[] = [];
  let callsFailed = 0;
  let lastCallAt = 0;

  for (let cursor = from; cursor < to; ) {
    const chunkEnd = addDaysUtc(cursor, FULL_SYNC_CHUNK_DAYS) < to ? addDaysUtc(cursor, FULL_SYNC_CHUNK_DAYS) : to;

    const wait = lastCallAt === 0 ? 0 : FULL_SYNC_MIN_MS_BETWEEN_CALLS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();

    try {
      taskIds.push(...(await pushAriForDateRange(propertyId, cursor, chunkEnd)));
    } catch (err) {
      callsFailed++;
      console.error(`[channex-ari] full sync ${propertyName} ${cursor.toISOString()}..${chunkEnd.toISOString()} failed:`, err);
    }
    cursor = chunkEnd;
  }

  return { propertyId, propertyName, taskIds, callsFailed };
}

// Every Channex-provisioned property, once. Channex explicitly allows a full
// sync "once every 24h if required" (certification test 13) - this is the
// job a daily cron should call, which is what closes the gap routine pushes
// leave: they only ever cover 365 days out, so without this, the far
// 366-500 days of what an OTA can show a guest booking ahead never refresh
// once a property has existed long enough for that tail to matter.
export async function runFullSyncForAllChannexProperties(): Promise<{
  propertiesSynced: number;
  totalTaskIds: number;
  totalFailed: number;
  results: FullSyncPropertyResult[];
}> {
  const properties = await prisma.property.findMany({
    where: { channelProvider: "CHANNEX", channexListing: { isNot: null } },
    select: { id: true, name: true },
  });

  const results: FullSyncPropertyResult[] = [];
  for (const p of properties) {
    results.push(await runFullSyncForProperty(p.id, p.name));
  }

  return {
    propertiesSynced: results.length,
    totalTaskIds: results.reduce((sum, r) => sum + r.taskIds.length, 0),
    totalFailed: results.reduce((sum, r) => sum + r.callsFailed, 0),
    results,
  };
}
