import { PrismaClient } from "@prisma/client";

// A census of the tables whose loss would actually hurt, for proving a
// backup restores.
//
// The reason this exists rather than "open the restored database and have a
// look": a restore that silently loses the last few hours, or that brings
// back rows without the relations hanging off them, looks completely fine to
// a human clicking around. It only shows up as a number that does not match.
// So run this against production, run it against the restored copy, and
// compare - a drill with no comparison step is not a drill, it is optimism.
//
//   DATABASE_URL="postgres://...production..." npx tsx scripts/db-census.ts > before.json
//   DATABASE_URL="postgres://...restored..."   npx tsx scripts/db-census.ts > after.json
//   npx tsx scripts/db-census.ts --compare before.json after.json
//
// Counts only. No guest names, emails, phone numbers or access codes are
// read or printed, so the output is safe to paste into a chat or an issue.

interface Census {
  takenAt: string;
  counts: Record<string, number>;
  newest: Record<string, string | null>;
  integrity: Record<string, number>;
}

async function takeCensus(): Promise<Census> {
  const prisma = new PrismaClient();
  try {
    const [
      users, properties, reservations, guests, messages, accessCodes,
      cleaningTasks, cityTaxCharges, ariOutbox, cronRuns, notifications,
      templates, channexListings,
    ] = await Promise.all([
      prisma.user.count(), prisma.property.count(), prisma.reservation.count(),
      prisma.guest.count(), prisma.message.count(), prisma.accessCode.count(),
      prisma.cleaningTask.count(), prisma.cityTaxCharge.count(),
      prisma.ariOutbox.count(), prisma.cronRun.count(), prisma.notification.count(),
      prisma.messageTemplate.count(), prisma.channexListing.count(),
    ]);

    // How fresh the restore is. A backup can be complete and still be a day
    // old; comparing counts alone would not show that, but the newest row
    // in each of the tables that changes constantly will.
    const [newestReservation, newestMessage, newestCronRun] = await Promise.all([
      prisma.reservation.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.message.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.cronRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    ]);

    // Rows that exist but whose parent does not. A restore that dropped a
    // table's contents while keeping its children leaves exactly this, and
    // counts alone would not catch it.
    //
    // Raw LEFT JOINs rather than Prisma filters, for two reasons. Prisma
    // cannot express "the row on the other side of a required relation is
    // missing" - the foreign key is supposed to make that impossible, so
    // there is no filter for it. And that is exactly the assumption worth
    // testing: some restore methods reload data with constraints disabled
    // and never re-enable them, which produces a database that looks intact
    // and silently is not.
    const orphans = async (child: string, fk: string, parent: string): Promise<number> => {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "${child}" c
         LEFT JOIN "${parent}" p ON p.id = c."${fk}"
         WHERE p.id IS NULL`
      );
      return Number(rows[0]?.n ?? 0);
    };
    const [orphanReservations, orphanMessages, orphanCodes] = await Promise.all([
      orphans("Reservation", "propertyId", "Property").catch(() => -1),
      orphans("Message", "reservationId", "Reservation").catch(() => -1),
      orphans("AccessCode", "reservationId", "Reservation").catch(() => -1),
    ]);

    return {
      takenAt: new Date().toISOString(),
      counts: {
        users, properties, reservations, guests, messages, accessCodes,
        cleaningTasks, cityTaxCharges, ariOutbox, cronRuns, notifications,
        templates, channexListings,
      },
      newest: {
        reservation: newestReservation?.createdAt.toISOString() ?? null,
        message: newestMessage?.createdAt.toISOString() ?? null,
        cronRun: newestCronRun?.startedAt.toISOString() ?? null,
      },
      integrity: {
        orphanedReservations: orphanReservations,
        orphanedMessages: orphanMessages,
        orphanedAccessCodes: orphanCodes,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

function compare(before: Census, after: Census): number {
  let problems = 0;
  const pad = (s: string) => s.padEnd(22);

  console.log("\ntable                    production    restored   difference");
  console.log("-".repeat(62));
  for (const [table, count] of Object.entries(before.counts)) {
    const got = after.counts[table] ?? 0;
    const diff = got - count;
    // A restore is a point in time, so it is expected to be slightly BEHIND
    // production - rows written since the snapshot. Ahead is not possible
    // and means the two databases are not what you think they are.
    const bad = diff > 0 || (count > 0 && got === 0);
    if (bad) problems++;
    console.log(
      `${pad(table)} ${String(count).padStart(10)} ${String(got).padStart(11)} ${String(diff >= 0 ? "+" + diff : diff).padStart(12)}${bad ? "  <-- CHECK" : ""}`
    );
  }

  console.log("\nfreshness (how far behind the restore is)");
  for (const [k, v] of Object.entries(before.newest)) {
    const a = after.newest[k];
    if (!v || !a) { console.log(`  ${pad(k)} ${v ?? "none"} -> ${a ?? "none"}`); continue; }
    const lagMin = Math.round((new Date(v).getTime() - new Date(a).getTime()) / 60000);
    console.log(`  ${pad(k)} ${lagMin} minute(s) behind`);
  }

  console.log("\nintegrity (orphaned rows - must all be 0)");
  for (const [k, v] of Object.entries(after.integrity)) {
    if (v !== 0) problems++;
    // -1 is "the query itself failed", not "zero orphans". Reporting that as
    // a pass would be the worst outcome this whole script could produce.
    const note = v < 0 ? "  <-- CHECK COULD NOT RUN" : v !== 0 ? "  <-- CHECK" : "";
    console.log(`  ${pad(k)} ${v}${note}`);
  }

  console.log(
    problems === 0
      ? "\nPASS - the restore is complete and consistent."
      : `\nFAIL - ${problems} check(s) need attention. Do not rely on this backup.`
  );
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const { readFileSync } = await import("fs");
    const before = JSON.parse(readFileSync(args[1], "utf8")) as Census;
    const after = JSON.parse(readFileSync(args[2], "utf8")) as Census;
    process.exit(compare(before, after) === 0 ? 0 : 1);
  }
  console.log(JSON.stringify(await takeCensus(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
