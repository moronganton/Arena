import { prisma } from "@/lib/prisma";

export type AriKind = "AVAILABILITY" | "RATE" | "RESTRICTION";

// How far out to push when a change doesn't imply its own range - a
// PricingRule with no end date, or a basePrice edit. Far enough to cover
// what an OTA calendar actually shows a guest, not "forever": pushing a
// year of restriction rows for one basePrice edit is already a lot of rows
// for the drain worker to coalesce.
const ARI_PUSH_HORIZON_DAYS = 365;

export function defaultHorizon(): { from: Date; to: Date } {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + ARI_PUSH_HORIZON_DAYS);
  return { from, to };
}

// The single gate every call site below goes through. Never call Channex
// inline on save - this only ever queues a row, and only for a property
// whose channelProvider is CHANNEX. Today that is zero properties, so every
// call site wiring into this is inert until step 9 actually flips one.
export async function enqueueAriUpdate(
  propertyId: string,
  dateFrom: Date,
  dateTo: Date,
  kind: AriKind
): Promise<void> {
  if (!(dateTo > dateFrom)) return; // nothing to push

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { channelProvider: true },
  });
  if (property?.channelProvider !== "CHANNEX") return;

  await prisma.ariOutbox.create({
    data: { propertyId, dateFrom, dateTo, kind, status: "PENDING" },
  });
}
