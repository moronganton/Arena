import { PrismaClient } from "@prisma/client";

// Turns a copy of production into a safe staging database.
//
// The copy itself is the restore-drill procedure, unchanged - pg_dump straight
// into the staging service over Railway's private network, no file, no
// credential leaving Railway:
//
//   pg_dump --no-owner --no-privileges "$PROD_DATABASE_URL" \
//     | psql -q -v ON_ERROR_STOP=1 "$STAGING_DATABASE_URL"
//
// That gives staging production's real shape: the same schema, the same
// reservations, the same message history to test an AI reply against. What it
// ALSO gives it, unless this script then runs, is the ability to act on the
// real world - because every copied row carries identifiers that point at live
// things. A door that opens. A card that charges. A booking feed that, once
// acknowledged here, production never sees.
//
//   DATABASE_URL="<staging>" npx tsx scripts/staging-scrub.ts               # dry run
//   DATABASE_URL="<staging>" npx tsx scripts/staging-scrub.ts --apply --confirm-database=<name>
//
// Dry run by default. --apply needs --confirm-database to match the database
// actually connected, so a shell with the wrong DATABASE_URL exported cannot
// delete anything by being run twice.

interface Plan {
  smoobuProperties: { id: string; name: string }[];
  smartLocks: number;
  accessCodes: number;
  pushSubscriptions: number;
  cardsOnFile: number;
  channexListings: { id: string; propertyName: string }[];
  ariOutboxRows: number;
}

// Refusing to run against production, by more than one signal.
//
// This script deletes properties. Run against production by accident - a shell
// where DATABASE_URL is still exported from the last task - it would delete the
// two Bratislava properties and everything hanging off them. So: an explicit
// database name that must match, plus a check on the app URL, plus a dry run
// default. Any one of those alone is a single point of failure.
async function assertNotProduction(prisma: PrismaClient, confirmDatabase: string): Promise<void> {
  // Cheapest and most definitive signal first. It needs no connection, so it
  // still fires when the database is unreachable - and a run aimed at
  // production from a production shell is exactly the case where you want the
  // refusal before anything else is attempted.
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "";
  if (/(^|\/\/)app\.host24\.ai/.test(appUrl)) {
    throw new Error(`refusing to run: NEXTAUTH_URL is ${appUrl}, which is production`);
  }

  const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()");
  const actual = rows[0]?.current_database ?? "(unknown)";
  if (actual !== confirmDatabase) {
    throw new Error(
      `refusing to run: connected to database "${actual}" but --confirm-database=${confirmDatabase}. ` +
        `Check which DATABASE_URL is exported in this shell.`
    );
  }
}

async function buildPlan(prisma: PrismaClient): Promise<Plan> {
  // Everything still on Smoobu goes. Staging has no business holding the two
  // properties that are running the live business through another provider,
  // and their reservations, messages and guests go with them.
  const smoobuProperties = await prisma.property.findMany({
    where: { channelProvider: "SMOOBU" },
    select: { id: true, name: true },
  });
  const channexListings = await prisma.channexListing.findMany({
    select: { id: true, property: { select: { name: true } } },
  });

  return {
    smoobuProperties,
    // Every lock, not only the ones on Smoobu properties. A SmartLock row plus
    // a copied TTLockAccount is enough to issue a working PIN on a real front
    // door from staging - see the note in the summary below.
    smartLocks: await prisma.smartLock.count(),
    accessCodes: await prisma.accessCode.count(),
    pushSubscriptions: await prisma.pushSubscription.count(),
    cardsOnFile: await prisma.guestCardOnFile.count(),
    channexListings: channexListings.map((l) => ({ id: l.id, propertyName: l.property.name })),
    ariOutboxRows: await prisma.ariOutbox.count(),
  };
}

async function apply(prisma: PrismaClient, plan: Plan): Promise<void> {
  const propertyIds = plan.smoobuProperties.map((p) => p.id);

  // Order matters: children before parents, because these relations are not
  // all ON DELETE CASCADE.
  if (propertyIds.length > 0) {
    const reservations = await prisma.reservation.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true },
    });
    const reservationIds = reservations.map((r) => r.id);

    await prisma.message.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.accessCode.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.cityTaxCharge.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.guestCardOnFile.deleteMany({ where: { reservationId: { in: reservationIds } } });
    await prisma.cleaningTask.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.damageReport.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.reservation.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.pricingRule.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.calendarBlock.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.smartLock.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.propertyKnowledge.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.recurringExpense.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.perReservationCost.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.expense.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await prisma.property.deleteMany({ where: { id: { in: propertyIds } } });
  }

  // Physical-world side effects. A reservation created in staging runs
  // autoGenerateCodesForReservation, which calls TTLock for real - the account
  // credentials came across in the copy. Without a SmartLock row there is
  // nothing for it to address.
  await prisma.accessCode.deleteMany({});
  await prisma.smartLock.deleteMany({});

  // Money. A saved card in staging is a real card that a real Stripe key can
  // charge.
  await prisma.guestCardOnFile.deleteMany({});
  await prisma.channexListing.updateMany({
    data: { paymentInstallationId: null, paymentProviderId: null },
  });

  // Push notifications registered against the operator's actual phone.
  await prisma.pushSubscription.deleteMany({});

  // Anything queued for Channex in production must not be re-pushed from here.
  await prisma.ariOutbox.deleteMany({});

  // Cron history describes runs that happened somewhere else; leaving it makes
  // staging's own health page report freshness it has not earned.
  await prisma.cronRun.deleteMany({});
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const confirmArg = args.find((a) => a.startsWith("--confirm-database="));
  const confirmDatabase = confirmArg?.split("=")[1] ?? "";

  const prisma = new PrismaClient();
  try {
    if (isApply) {
      if (!confirmDatabase) {
        throw new Error("--apply requires --confirm-database=<name> (run without --apply to see the plan)");
      }
      await assertNotProduction(prisma, confirmDatabase);
    }

    const plan = await buildPlan(prisma);

    console.log(isApply ? "APPLYING" : "DRY RUN - nothing will be changed");
    console.log("");
    console.log("Properties to remove (channelProvider = SMOOBU):");
    if (plan.smoobuProperties.length === 0) console.log("  (none)");
    for (const p of plan.smoobuProperties) console.log(`  - ${p.name}`);
    console.log("");
    console.log("Kept on Channex:");
    if (plan.channexListings.length === 0) console.log("  (none)");
    for (const l of plan.channexListings) console.log(`  - ${l.propertyName}`);
    console.log("");
    console.log("Also cleared, everywhere:");
    console.log(`  smart locks          ${plan.smartLocks}`);
    console.log(`  access codes         ${plan.accessCodes}`);
    console.log(`  saved cards          ${plan.cardsOnFile}`);
    console.log(`  push subscriptions   ${plan.pushSubscriptions}`);
    console.log(`  queued ARI rows      ${plan.ariOutboxRows}`);
    console.log(`  Channex payment app  nulled on ${plan.channexListings.length} listing(s)`);
    console.log("");

    if (!isApply) {
      console.log("Re-run with --apply --confirm-database=<name> to make these changes.");
      return;
    }

    await apply(prisma, plan);
    console.log("Done.");
    console.log("");
    console.log("Still yours to do, because none of it lives in this database:");
    console.log("  1. Give staging its OWN Channex API key. Sharing production's means");
    console.log("     staging can acknowledge production's bookings on the account-wide");
    console.log("     revision feed, and production would never see them.");
    console.log("  2. Set CHANNEX_BASE_URL explicitly in both environments - it defaults");
    console.log("     to staging, so an unset value in production writes to the wrong place.");
    console.log("  3. Re-provision the Channex property for staging, or the copied");
    console.log("     ChannexListing still points at the property production sells.");
    console.log("  4. Point no cron pinger at staging.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
