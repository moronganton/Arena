import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One-time removal of the demo properties seeded by prisma/seed.ts and
// /api/setup. Every property of yours EXCEPT the ones named below is deleted,
// together with its reservations, messages, access codes, cleaning tasks,
// expenses and settings.
//
//   GET /api/properties/cleanup                → dry run, deletes nothing
//   GET /api/properties/cleanup?confirm=DELETE → performs the deletion
//
// The dry run is the safety mechanism: it lists exactly what would go, so a
// human reads the list before anything is destroyed. Nothing here is
// reversible, so the destructive path is never the default.

const KEEP_NAMES = [
  "Luxury Skyline 1BDRM Apart 29th Floor Bratislava",
  "Sinteu 3 bedroom apartment - 6PAX",
];

const norm = (s: string) => s.trim().toLowerCase();
const KEEP = new Set(KEEP_NAMES.map(norm));

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const ownerId = session.user.id;
  const confirmed = new URL(req.url).searchParams.get("confirm") === "DELETE";

  const properties = await prisma.property.findMany({
    where: { ownerId },
    select: {
      id: true,
      name: true,
      _count: { select: { reservations: true } },
    },
    orderBy: { name: "asc" },
  });

  // A real booking must never be destroyed by a name-matching rule, so any
  // property carrying Smoobu-synced reservations is kept regardless of name.
  const withSmoobu = await prisma.reservation.groupBy({
    by: ["propertyId"],
    where: { property: { ownerId }, externalId: { startsWith: "smoobu-" } },
    _count: { _all: true },
  });
  const smoobuByProperty = new Map(withSmoobu.map((g) => [g.propertyId, g._count._all]));

  const keep: typeof properties = [];
  const remove: typeof properties = [];
  const keptOnlyBySmoobuGuard: string[] = [];

  for (const p of properties) {
    const namedKeep = KEEP.has(norm(p.name));
    const smoobuCount = smoobuByProperty.get(p.id) ?? 0;
    if (namedKeep || smoobuCount > 0) {
      keep.push(p);
      if (!namedKeep) keptOnlyBySmoobuGuard.push(`${p.name} (${smoobuCount} Smoobu booking(s))`);
    } else {
      remove.push(p);
    }
  }

  const propertyIds = remove.map((p) => p.id);

  const preview = {
    keeping: keep.map((p) => ({ name: p.name, reservations: p._count.reservations })),
    deleting: remove.map((p) => ({ name: p.name, reservations: p._count.reservations })),
    keptBySmoobuGuard: keptOnlyBySmoobuGuard,
  };

  if (!confirmed) {
    return NextResponse.json({
      dryRun: true,
      message:
        "Nothing has been deleted. Check the lists below, then re-run with &confirm=DELETE to apply.",
      ...preview,
      namesNotFound: KEEP_NAMES.filter((n) => !properties.some((p) => norm(p.name) === norm(n))),
    });
  }

  if (propertyIds.length === 0) {
    return NextResponse.json({ deleted: false, message: "Nothing to delete.", ...preview });
  }

  // Collect every dependent id up front. Almost nothing in the schema cascades,
  // so each child table has to be cleared explicitly, deepest first.
  const reservations = await prisma.reservation.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { id: true, guestId: true },
  });
  const reservationIds = reservations.map((r) => r.id);
  const guestIds = [...new Set(reservations.map((r) => r.guestId))];

  const cleaningTasks = await prisma.cleaningTask.findMany({
    where: {
      OR: [{ propertyId: { in: propertyIds } }, { reservationId: { in: reservationIds } }],
    },
    select: { id: true },
  });
  const cleaningTaskIds = cleaningTasks.map((c) => c.id);

  const locks = await prisma.smartLock.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { id: true },
  });
  const lockIds = locks.map((l) => l.id);

  const templates = await prisma.messageTemplate.findMany({
    where: { propertyId: { in: propertyIds } }, // null propertyId = global, never touched
    select: { id: true },
  });
  const templateIds = templates.map((t) => t.id);

  const inProps = { propertyId: { in: propertyIds } };

  const [
    damageReports,
    accessCodes,
    messages,
    templateSends,
    tasks,
    resns,
    smartLocks,
    templateImages,
    msgTemplates,
    checklistItems,
    knowledge,
    recurringExpenses,
    expenses,
    channels,
    pricingRules,
    calendarBlocks,
    deletedProperties,
    orphanGuests,
  ] = await prisma.$transaction([
    prisma.damageReport.deleteMany({
      where: { OR: [inProps, { cleaningTaskId: { in: cleaningTaskIds } }] },
    }),
    prisma.accessCode.deleteMany({
      where: { OR: [{ reservationId: { in: reservationIds } }, { lockId: { in: lockIds } }] },
    }),
    prisma.message.deleteMany({ where: { reservationId: { in: reservationIds } } }),
    prisma.messageTemplateSend.deleteMany({
      where: { OR: [{ reservationId: { in: reservationIds } }, { templateId: { in: templateIds } }] },
    }),
    prisma.cleaningTask.deleteMany({ where: { id: { in: cleaningTaskIds } } }),
    prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } }),
    prisma.smartLock.deleteMany({ where: { id: { in: lockIds } } }),
    prisma.templateImage.deleteMany({ where: { templateId: { in: templateIds } } }),
    prisma.messageTemplate.deleteMany({ where: { id: { in: templateIds } } }),
    prisma.cleaningChecklistItem.deleteMany({ where: inProps }),
    prisma.propertyKnowledge.deleteMany({ where: inProps }),
    prisma.recurringExpense.deleteMany({ where: inProps }),
    prisma.expense.deleteMany({ where: inProps }),
    prisma.channelConfig.deleteMany({ where: inProps }), // also clears Smoobu mappings
    prisma.pricingRule.deleteMany({ where: inProps }),
    prisma.calendarBlock.deleteMany({ where: inProps }),
    prisma.property.deleteMany({ where: { id: { in: propertyIds }, ownerId } }),
    // Guests left with no bookings at all once the demo reservations are gone.
    prisma.guest.deleteMany({ where: { id: { in: guestIds }, reservations: { none: {} } } }),
  ]);

  return NextResponse.json({
    deleted: true,
    message: "Demo properties removed.",
    ...preview,
    counts: {
      properties: deletedProperties.count,
      reservations: resns.count,
      messages: messages.count,
      accessCodes: accessCodes.count,
      smartLocks: smartLocks.count,
      cleaningTasks: tasks.count,
      damageReports: damageReports.count,
      checklistItems: checklistItems.count,
      expenses: expenses.count,
      recurringExpenses: recurringExpenses.count,
      knowledge: knowledge.count,
      channelConfigs: channels.count,
      pricingRules: pricingRules.count,
      calendarBlocks: calendarBlocks.count,
      messageTemplates: msgTemplates.count,
      templateImages: templateImages.count,
      templateSends: templateSends.count,
      guests: orphanGuests.count,
    },
  });
}
