import { prisma } from "@/lib/prisma";

// What actually manages each property's OTA connectivity, in one place.
//
// The app had drifted into three overlapping ideas of a "channel", and the UI
// was reading the oldest of them: ChannelConfig rows, written back when a
// channel meant either an OTA (Booking.com) or a manager (Smoobu) with no
// distinction between the two. Property.channelProvider became the real
// answer to "who owns this listing" when Channex arrived, and ChannexListing
// holds its mapping - but nothing on screen read either, so a property could
// show a channel manager it had left months earlier.
//
// Computed here rather than in a route so the property page (a server
// component reading Prisma directly) and the Channels settings page (a client
// component fetching an API) cannot drift apart in what they report.
//
//   manager   - who owns connectivity, straight from channelProvider
//   channex   - the room type and rate plan, and how the ARI queue is doing
//   smoobu    - the mapped apartment, and when it last synced
//   icalFeeds - genuine per-OTA iCal feeds, which are a different thing
//               entirely and survive alongside whichever manager is in use
export interface PropertyChannelState {
  id: string;
  name: string;
  active: boolean;
  manager: string;
  warning: string | null;
  channex: {
    propertyId: string;
    roomTypeId: string;
    ratePlanId: string;
    connectedAt: Date;
    pendingUpdates: number;
    failedUpdates: number;
    lastPushAt: Date | null;
  } | null;
  smoobu: { apartmentId: string | null; lastSyncAt: Date | null } | null;
  icalFeeds: Array<{ channel: string; icalUrl: string | null; lastSyncAt: Date | null; isActive: boolean }>;
}

export async function getChannelState(ownerId: string, propertyId?: string): Promise<PropertyChannelState[]> {
  const properties = await prisma.property.findMany({
    where: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
    select: {
      id: true,
      name: true,
      active: true,
      channelProvider: true,
      channexListing: true,
      channels: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const propertyIds = properties.map((p) => p.id);

  // How the ARI queue is doing per property: anything still waiting, anything
  // that gave up, and when a push last completed. This is the difference
  // between "Channex is configured" and "Channex is actually being fed".
  const [pending, failed, lastDone] = await Promise.all([
    prisma.ariOutbox.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: propertyIds }, status: "PENDING" },
      _count: { _all: true },
    }),
    prisma.ariOutbox.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: propertyIds }, status: "FAILED" },
      _count: { _all: true },
    }),
    prisma.ariOutbox.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: propertyIds }, status: "DONE" },
      _max: { updatedAt: true },
    }),
  ]);
  const pendingBy = new Map(pending.map((r) => [r.propertyId, r._count._all]));
  const failedBy = new Map(failed.map((r) => [r.propertyId, r._count._all]));
  const lastPushBy = new Map(lastDone.map((r) => [r.propertyId, r._max.updatedAt]));

  const rows = properties.map((p) => {
    const smoobu = p.channels.find((c) => c.channel === "SMOOBU" && c.listingId);
    // An OTA row only counts as a real feed when it actually carries one.
    const icalFeeds = p.channels
      .filter((c) => c.channel !== "SMOOBU" && c.channel !== "BEDS24" && c.icalUrl)
      .map((c) => ({ channel: c.channel, icalUrl: c.icalUrl, lastSyncAt: c.lastSyncAt, isActive: c.isActive }));

    // A property flagged for a manager it has no mapping for is misconfigured
    // rather than merely unmapped, and is worth saying so out loud.
    let warning: string | null = null;
    if (p.channelProvider === "CHANNEX" && !p.channexListing) {
      warning = "Set to Channex but not provisioned there yet - nothing will sync.";
    } else if (p.channelProvider === "SMOOBU" && !smoobu) {
      warning = "Set to Smoobu but no apartment is mapped - bookings will not import.";
    }

    const otherManagers = p.channels
      .filter((c) => (c.channel === "SMOOBU" || c.channel === "BEDS24") && c.channel !== p.channelProvider)
      .map((c) => c.channel);
    if (otherManagers.length > 0) {
      warning = `Also mapped to ${otherManagers.join(", ")}. Two channel managers on one listing can double-book it.`;
    }

    return {
      id: p.id,
      name: p.name,
      active: p.active,
      manager: p.channelProvider,
      warning,
      channex:
        p.channelProvider === "CHANNEX" && p.channexListing
          ? {
              propertyId: p.channexListing.channexPropertyId,
              roomTypeId: p.channexListing.channexRoomTypeId,
              ratePlanId: p.channexListing.channexRatePlanId,
              connectedAt: p.channexListing.createdAt,
              pendingUpdates: pendingBy.get(p.id) ?? 0,
              failedUpdates: failedBy.get(p.id) ?? 0,
              lastPushAt: lastPushBy.get(p.id) ?? null,
            }
          : null,
      smoobu: smoobu ? { apartmentId: smoobu.listingId, lastSyncAt: smoobu.lastSyncAt } : null,
      icalFeeds,
    };
  });

  return rows;
}
