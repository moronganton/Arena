import { prisma } from "@/lib/prisma";
import { channexDelete, ChannexError } from "@/lib/channels/channex-core";

// Deleting a property for good, as opposed to hiding it.
//
// "Remove" has always been a soft delete - active: false - which is right for
// a listing that stops trading and wrong for the half dozen properties created
// while testing an import flow. Those keep appearing in every list, keep a
// Channex property alive on the account, and cannot be cleared from the UI at
// all.
//
// Two rules make this safe enough to expose:
//
//   1. It REFUSES rather than cascades when the property holds anything worth
//      keeping - a reservation, an expense, a cost, a damage report. Those are
//      guest and financial records; a delete button is not the place to
//      discover they are gone. Everything else (queued pushes, pricing rules,
//      cleaning tasks, locks, knowledge, channel rows) is configuration, and
//      goes with the property it configures.
//   2. Only MessageTemplate cascades in the schema. Everything else restricts,
//      so the order below is not tidiness - a delete in the wrong order fails
//      on a foreign key halfway through and leaves the property half gone.

/**
 * Whether permanent deletion is allowed in this environment at all.
 *
 * Off unless explicitly switched on, and checked on the server rather than by
 * hiding a button - a hidden button still leaves the endpoint answering, which
 * is not a safety control. Production has live listings whose reservations,
 * expenses and channel mappings a mis-click must not be able to reach, so the
 * capability stays in the codebase, tested, and simply refuses to run there.
 *
 * Set ALLOW_PROPERTY_PURGE=true only where losing a property is recoverable.
 */
export function propertyPurgeAllowed(): boolean {
  return process.env.ALLOW_PROPERTY_PURGE === "true";
}

export interface DeleteBlockers {
  reservations: number;
  expenses: number;
  perReservationCosts: number;
  damageReports: number;
}

export interface DeletePropertyResult {
  ok: boolean;
  /** Present when the property holds records this refuses to destroy. */
  blockers?: DeleteBlockers;
  /** What was removed on Channex, or why it could not be. */
  channexNote?: string;
  error?: string;
}

export async function countDeleteBlockers(propertyId: string): Promise<DeleteBlockers> {
  const [reservations, expenses, perReservationCosts, damageReports] = await Promise.all([
    prisma.reservation.count({ where: { propertyId } }),
    prisma.expense.count({ where: { propertyId } }),
    prisma.perReservationCost.count({ where: { propertyId } }),
    prisma.damageReport.count({ where: { propertyId } }),
  ]);
  return { reservations, expenses, perReservationCosts, damageReports };
}

export function hasBlockers(b: DeleteBlockers): boolean {
  return b.reservations + b.expenses + b.perReservationCosts + b.damageReports > 0;
}

/** What to tell someone whose delete was refused, in their terms. */
export function describeBlockers(b: DeleteBlockers): string {
  const parts: string[] = [];
  if (b.reservations) parts.push(`${b.reservations} reservation${b.reservations === 1 ? "" : "s"}`);
  if (b.expenses) parts.push(`${b.expenses} expense${b.expenses === 1 ? "" : "s"}`);
  if (b.perReservationCosts) parts.push(`${b.perReservationCosts} booking cost${b.perReservationCosts === 1 ? "" : "s"}`);
  if (b.damageReports) parts.push(`${b.damageReports} damage report${b.damageReports === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export async function deletePropertyForGood(
  propertyId: string,
  ownerId: string
): Promise<DeletePropertyResult> {
  // Checked first, before anything is read or counted: an environment that
  // does not permit this should not even reveal whether the property exists.
  if (!propertyPurgeAllowed()) {
    return {
      ok: false,
      error:
        "Deleting a property permanently is switched off in this environment. " +
        "It can be hidden from your listings instead.",
    };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId },
    select: { id: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property) return { ok: false, error: "Property not found" };

  const blockers = await countDeleteBlockers(propertyId);
  if (hasBlockers(blockers)) return { ok: false, blockers, error: "This property still holds records" };

  // Channex first, and only best-effort. A property left behind there is
  // untidy; a property deleted here while its Channex twin goes on receiving
  // bookings is a listing nobody owns - so if Channex refuses, that is said
  // out loud rather than silently ignored.
  let channexNote: string | undefined;
  if (property.channexListing) {
    try {
      await channexDelete(`/properties/${property.channexListing.channexPropertyId}`);
      channexNote = "Also removed from your channel manager.";
    } catch (err) {
      const e = err as ChannexError;
      channexNote =
        e.status === 404
          ? "It was already gone from your channel manager."
          : `Couldn't remove it from your channel manager (${e.message}) - delete it there by hand.`;
    }
  }

  // Ordered by dependency, not by name. DamageReport points at CleaningTask,
  // so it goes first; ChannexListing owns RatePlan rows by cascade.
  await prisma.$transaction([
    prisma.damageReport.deleteMany({ where: { propertyId } }),
    prisma.cleaningChecklistItem.deleteMany({ where: { propertyId } }),
    prisma.cleaningTask.deleteMany({ where: { propertyId } }),
    prisma.ariOutbox.deleteMany({ where: { propertyId } }),
    prisma.propertyKnowledge.deleteMany({ where: { propertyId } }),
    prisma.recurringExpense.deleteMany({ where: { propertyId } }),
    prisma.channelConfig.deleteMany({ where: { propertyId } }),
    prisma.pricingRule.deleteMany({ where: { propertyId } }),
    prisma.calendarBlock.deleteMany({ where: { propertyId } }),
    prisma.smartLock.deleteMany({ where: { propertyId } }),
    prisma.channexListing.deleteMany({ where: { propertyId } }),
    prisma.property.delete({ where: { id: propertyId } }),
  ]);

  return { ok: true, channexNote };
}
