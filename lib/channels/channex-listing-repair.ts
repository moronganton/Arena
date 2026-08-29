import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, ChannexError } from "./channex-core";
import { connectedChannels, type ChannelConnectionLike, type ChannelKey } from "./channel-offers";

// Checking that what host24 RECORDS about a property on Channex is still true
// there, and rebuilding the pieces that are not.
//
// A ChannexListing stores three ids - property, room type, rate plan - written
// once at provisioning and never verified again. They can stop being true
// without anything here noticing: a room type deleted in the Channex UI takes
// its rate plans with it, a staging account gets cleaned out, a half-finished
// provisioning run leaves a property with no room type.
//
// The failure is silent and confusing rather than loud. The property page goes
// on saying "Channex connected", the Rate plans tab goes on offering to build
// a family, and the one place it surfaces is Channex's own mapping screen,
// which says "No data" in the room-type dropdown and lets the operator
// conclude that a channel cannot be mapped without a default rate. The real
// answer - the room type this listing points at does not exist - is not
// visible anywhere.
//
// Provisioning cannot fix it: /api/channex/provision always creates a NEW
// property and then inserts a ChannexListing, which collides on the unique
// propertyId. Hence a repair that works on the listing already there.

export interface ListingHealth {
  propertyExists: boolean;
  roomTypeExists: boolean;
  ratePlanExists: boolean;
  /** True when everything recorded is really there. */
  ok: boolean;
}

async function existsById(path: string, id: string): Promise<boolean> {
  try {
    await channexGet(`${path}/${id}`);
    return true;
  } catch (err) {
    const e = err as ChannexError;
    if (e.status === 404) return false;
    throw err;
  }
}

export async function checkListingHealth(propertyId: string): Promise<ListingHealth | null> {
  const listing = await prisma.channexListing.findUnique({ where: { propertyId } });
  if (!listing) return null;

  const propertyExists = await existsById("/properties", listing.channexPropertyId);
  // A room type and rate plan cannot outlive the property that holds them, so
  // asking about them once it is gone would only produce noise.
  if (!propertyExists) {
    return { propertyExists: false, roomTypeExists: false, ratePlanExists: false, ok: false };
  }

  const [roomTypeExists, ratePlanExists] = await Promise.all([
    existsById("/room_types", listing.channexRoomTypeId),
    existsById("/rate_plans", listing.channexRatePlanId),
  ]);

  return {
    propertyExists,
    roomTypeExists,
    ratePlanExists,
    ok: propertyExists && roomTypeExists && ratePlanExists,
  };
}

export interface RepairResult {
  ok: boolean;
  health: ListingHealth;
  actions: string[];
  error?: string;
}

/**
 * Rebuild whatever is missing under an existing Channex property, and point
 * the listing at it.
 *
 * A missing Channex PROPERTY is deliberately not repaired here. Recreating it
 * would orphan whatever the old one still holds - reservations, channel
 * connections, mappings - and quietly give the operator a second property on
 * their account. That case is reported and left to a human.
 */
export async function repairListing(propertyId: string): Promise<RepairResult> {
  const listing = await prisma.channexListing.findUnique({
    where: { propertyId },
    include: { property: { select: { name: true, currency: true, maxGuests: true } } },
  });
  if (!listing) {
    return {
      ok: false,
      health: { propertyExists: false, roomTypeExists: false, ratePlanExists: false, ok: false },
      actions: [],
      error: "This property has no Channex listing to repair.",
    };
  }

  const health = await checkListingHealth(propertyId);
  if (!health) {
    return { ok: false, health: { propertyExists: false, roomTypeExists: false, ratePlanExists: false, ok: false }, actions: [], error: "No listing" };
  }
  if (health.ok) return { ok: true, health, actions: [] };

  if (!health.propertyExists) {
    return {
      ok: false,
      health,
      actions: [],
      error:
        "This property no longer exists on Channex. Recreating it would leave the old one's " +
        "reservations and channel connections behind, so it needs setting up again deliberately " +
        "rather than repairing.",
    };
  }

  const actions: string[] = [];
  let roomTypeId = listing.channexRoomTypeId;

  try {
    if (!health.roomTypeExists) {
      const created = await channexPost<{ id: string }>("/room_types", {
        room_type: {
          property_id: listing.channexPropertyId,
          title: `${listing.property.name} - entire place`,
          count_of_rooms: 1,
          occ_adults: listing.property.maxGuests,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: listing.property.maxGuests,
          room_kind: "room",
        },
      });
      roomTypeId = created.data.id;
      actions.push(`created room type ${roomTypeId}`);
    }

    let ratePlanId = listing.channexRatePlanId;
    // A rate plan is rebuilt whenever its room type was, even if the plan
    // itself still answered: a plan under a room type that no longer exists
    // cannot be sold through, and would collide by title with the new one.
    if (!health.ratePlanExists || !health.roomTypeExists) {
      const created = await channexPost<{ id: string }>("/rate_plans", {
        rate_plan: {
          property_id: listing.channexPropertyId,
          room_type_id: roomTypeId,
          title: "Standard Rate",
          currency: listing.property.currency,
          sell_mode: "per_room",
          rate_mode: "manual",
          // Zero on purpose: the real price arrives on the first ARI push, and
          // a plausible placeholder is worse than an obviously unset one.
          options: [{ occupancy: listing.property.maxGuests, is_primary: true, rate: 0 }],
        },
      });
      ratePlanId = created.data.id;
      actions.push(`created rate plan ${ratePlanId}`);
    }

    await prisma.channexListing.update({
      where: { propertyId },
      data: { channexRoomTypeId: roomTypeId, channexRatePlanId: ratePlanId },
    });
    // Rows describing a family built on ids that no longer exist would send
    // the next push into nothing.
    await prisma.ratePlan.deleteMany({ where: { channexListingId: listing.id } });
    actions.push("re-pointed the listing and cleared its rate plan records");

    return { ok: true, health: await checkListingHealth(propertyId) ?? health, actions };
  } catch (err) {
    const e = err as ChannexError;
    return { ok: false, health, actions, error: `${e.message}` };
  }
}

/**
 * The two account-wide facts every listing screen needs, in two calls total
 * rather than two per property: which Channex properties still exist, and
 * which OTAs are actually connected to each.
 *
 * The second is the one an operator means by "connected". A property can sit
 * on Channex perfectly well with no channel attached to it at all - which is
 * what deleting a Booking.com connection leaves behind - and every local
 * signal (the flag, the listing row, the last push) goes on looking healthy,
 * because locally nothing changed. Only Channex knows, and only per channel:
 * connections are reported account-wide with the property ids each covers.
 */
export async function fetchChannexOverview(): Promise<{
  propertyIds: Set<string>;
  otasByProperty: Map<string, ChannelKey[]>;
} | null> {
  const propertyIds = await existingChannexPropertyIds();
  if (propertyIds === null) return null;

  try {
    const rows: ChannelConnectionLike[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await channexGet<ChannelConnectionLike[]>(
        `/channels?pagination[page]=${page}&pagination[limit]=100`
      );
      const batch = res.data ?? [];
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    const otasByProperty = new Map<string, ChannelKey[]>();
    for (const id of propertyIds) otasByProperty.set(id, connectedChannels(rows, id));
    return { propertyIds, otasByProperty };
  } catch {
    // The existence answer is still worth having on its own.
    return { propertyIds, otasByProperty: new Map() };
  }
}

/**
 * Which of these Channex property ids still exist, in ONE call for the whole
 * account rather than one per property.
 *
 * The cheap half of checkListingHealth, for screens that list every property.
 * A per-property health check costs three requests each, which on a portfolio
 * turns a settings page into a rate-limit problem; asking "which properties
 * exist" once catches the case that actually strands an operator - the Channex
 * property gone from under a listing that still claims to be connected.
 *
 * Returns null when Channex could not be asked, which callers must render as
 * silence rather than as "nothing exists".
 */
export async function existingChannexPropertyIds(): Promise<Set<string> | null> {
  const found = new Set<string>();
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await channexGet<{ id?: string; attributes?: { id?: string } }[]>(
        `/properties?pagination[page]=${page}&pagination[limit]=100`
      );
      const rows = res.data ?? [];
      for (const r of rows) {
        const id = r.attributes?.id ?? r.id;
        if (id) found.add(id);
      }
      if (rows.length < 100) break;
    }
    return found;
  } catch {
    return null;
  }
}
