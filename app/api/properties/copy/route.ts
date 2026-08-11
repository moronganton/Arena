import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST { id, include?: { knowledge, checklist, pricing, templates, costRules } }
//   -> duplicates a property's SETUP onto a new property.
//
// What is copied is the interesting part. Property has 13 relations and they are
// not the same kind of thing:
//
//   COPYABLE SETUP (opt-in per group below)
//     knowledge, cleaning checklist, pricing rules, message templates,
//     recurring + per-reservation cost rules.
//
//   NEVER COPIED - history and live state
//     reservations, cleaning tasks, damage reports, one-off expenses, calendar
//     blocks. These describe things that happened at the real apartment; cloning
//     them would invent history and corrupt every finance and occupancy report.
//
//   NEVER COPIED - hardware and channel identity
//     smart locks and channel configs. A SmartLock.ttlockId is a physical device
//     and is @unique, so a copy is impossible as well as meaningless. Channel
//     configs are worse than impossible: they carry the OTA listingId, iCal URL
//     and API credentials, so copying one would point two StayHQ properties at
//     the SAME Booking.com listing - importing every reservation twice and
//     sending each guest two of every automated message. That is a data
//     corruption bug waiting to happen, so it is excluded with no opt-in.
//
// The new property is created ACTIVE. In this codebase active:false is how a
// property is soft-deleted (DELETE /api/properties/[id]) and inactive properties
// are hidden from Smoobu mapping, so an inactive copy would look deleted.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id, include } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const want = {
    knowledge: include?.knowledge !== false,
    checklist: include?.checklist !== false,
    pricing: include?.pricing !== false,
    templates: include?.templates === true,
    costRules: include?.costRules === true,
  };

  const source = await prisma.property.findFirst({
    where: { id, ownerId: userId },
    include: {
      knowledge: want.knowledge,
      checklistItems: want.checklist,
      pricingRules: want.pricing,
      messageTemplates: want.templates,
      recurringExpenses: want.costRules,
      perReservationCosts: want.costRules,
    },
  });
  if (!source) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const copied: Record<string, number> = {};

  // One transaction: a half-copied property with knowledge but no checklist, or
  // worse a property row with nothing attached, is harder to clean up than a
  // failure that leaves nothing behind.
  const property = await prisma.$transaction(async (tx) => {
    const created = await tx.property.create({
      data: {
        ownerId: userId,
        name: `${source.name} (copy)`,
        address: source.address,
        city: source.city,
        country: source.country,
        description: source.description,
        bedrooms: source.bedrooms,
        bathrooms: source.bathrooms,
        maxGuests: source.maxGuests,
        basePrice: source.basePrice,
        currency: source.currency,
        timezone: source.timezone,
        imageUrl: source.imageUrl,
        active: true,
      },
    });

    if (want.knowledge && source.knowledge?.length) {
      await tx.propertyKnowledge.createMany({
        data: source.knowledge.map((k) => ({
          propertyId: created.id,
          category: k.category,
          title: k.title,
          content: k.content,
          active: k.active,
          sortOrder: k.sortOrder,
        })),
      });
      copied.knowledge = source.knowledge.length;
    }

    if (want.checklist && source.checklistItems?.length) {
      await tx.cleaningChecklistItem.createMany({
        data: source.checklistItems.map((c) => ({
          propertyId: created.id,
          category: c.category,
          label: c.label,
          sortOrder: c.sortOrder,
          active: c.active,
        })),
      });
      copied.checklist = source.checklistItems.length;
    }

    if (want.pricing && source.pricingRules?.length) {
      await tx.pricingRule.createMany({
        data: source.pricingRules.map((r) => ({
          propertyId: created.id,
          name: r.name,
          ruleType: r.ruleType,
          startDate: r.startDate,
          endDate: r.endDate,
          daysOfWeek: r.daysOfWeek,
          price: r.price,
          adjustment: r.adjustment,
          adjType: r.adjType,
          minNights: r.minNights,
          priority: r.priority,
          active: r.active,
        })),
      });
      copied.pricing = source.pricingRules.length;
    }

    // Copied templates are PAUSED, same rule as /api/templates/copy: the body
    // carries hand-typed property specifics (WiFi, parking, door entry) that are
    // wrong for a different apartment, so nothing may auto-send before review.
    if (want.templates && source.messageTemplates?.length) {
      await tx.messageTemplate.createMany({
        data: source.messageTemplates.map((t) => ({
          userId,
          propertyId: created.id,
          name: t.name,
          trigger: t.trigger,
          offsetDays: t.offsetDays,
          sendHour: t.sendHour,
          subject: t.subject,
          body: t.body,
          active: false,
        })),
      });
      copied.templates = source.messageTemplates.length;
    }

    if (want.costRules) {
      if (source.recurringExpenses?.length) {
        await tx.recurringExpense.createMany({
          data: source.recurringExpenses.map((e) => ({
            ownerId: userId,
            propertyId: created.id,
            category: e.category,
            description: e.description,
            amount: e.amount,
            currency: e.currency,
            startDate: e.startDate,
            endDate: e.endDate,
          })),
        });
        copied.recurringCosts = source.recurringExpenses.length;
      }
      if (source.perReservationCosts?.length) {
        await tx.perReservationCost.createMany({
          data: source.perReservationCosts.map((c) => ({
            ownerId: userId,
            propertyId: created.id,
            category: c.category,
            description: c.description,
            amount: c.amount,
            currency: c.currency,
            startDate: c.startDate,
            endDate: c.endDate,
          })),
        });
        copied.perReservationCosts = source.perReservationCosts.length;
      }
    }

    return created;
  });

  return NextResponse.json(
    {
      property: { id: property.id, name: property.name },
      copied,
      // Stated back to the caller so the UI never has to guess, and so it is
      // obvious the new property is not yet connected to anything.
      notCopied: ["smart locks", "channel connections", "reservations", "cleaning history", "expenses", "calendar blocks"],
    },
    { status: 201 }
  );
}
