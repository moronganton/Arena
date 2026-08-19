import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One-time baseline for the `prisma db push` -> `prisma migrate` transition.
//
// This database's schema was built by `db push`, which keeps no history, so
// Prisma Migrate considers it unmanaged. Switching the start command to
// `prisma migrate deploy` while that is true fails with P3005 and exit code
// 1 - and because the start command chains with `&&`, `next start` would
// never run and the app would not boot. Verified against a local replica.
//
// The fix is to record 0_init as already-applied WITHOUT running its SQL
// (every table it describes already exists). That is exactly what
// `prisma migrate resolve --applied 0_init` does: it writes one row into
// _prisma_migrations whose checksum is the sha256 of migration.sql, with
// applied_steps_count = 0. This endpoint reproduces that row directly, since
// the Prisma CLI isn't reachable from a request handler.
//
// The checksum is read from the migration file at runtime rather than
// hardcoded, so it can never drift from what actually shipped.
//
//   GET  /api/debug/baseline-prisma-migrations             -> dry run, reports state only
//   GET  /api/debug/baseline-prisma-migrations?apply=true  -> performs the baseline
//
// Safe to re-run: it never writes if a 0_init row is already present.
const MIGRATION_NAME = "0_init";

// Prisma's own definition of its bookkeeping table.
const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  )
`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const apply = new URL(req.url).searchParams.get("apply") === "true";

  // Read the migration that shipped with this deploy and derive its checksum.
  const migrationPath = path.join(process.cwd(), "prisma", "migrations", MIGRATION_NAME, "migration.sql");
  let checksum: string;
  let sqlBytes: number;
  try {
    const sql = await readFile(migrationPath);
    sqlBytes = sql.length;
    checksum = createHash("sha256").update(sql).digest("hex");
  } catch (err) {
    return NextResponse.json(
      {
        error: "Could not read the baseline migration file - refusing to guess its checksum",
        migrationPath,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  const ledgerExisted = await tableExists();
  const rowsBefore = ledgerExisted ? await listRows() : [];
  const alreadyBaselined = rowsBefore.some((r) => r.migration_name === MIGRATION_NAME);

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing was written",
      migration: MIGRATION_NAME,
      migrationBytes: sqlBytes,
      checksum,
      ledgerTableExists: ledgerExisted,
      alreadyBaselined,
      rows: rowsBefore,
      whatWouldHappen: alreadyBaselined
        ? "Nothing - this database is already baselined."
        : "Create _prisma_migrations if absent, then insert one row marking 0_init as applied (applied_steps_count = 0). No schema is changed and no migration SQL is executed.",
      nextStep: alreadyBaselined
        ? "Baseline is done. The start command can safely switch to `prisma migrate deploy`."
        : "Re-open this URL with ?apply=true to perform the baseline.",
    });
  }

  if (alreadyBaselined) {
    return NextResponse.json({
      status: "already baselined - nothing written",
      migration: MIGRATION_NAME,
      rows: rowsBefore,
    });
  }

  await prisma.$executeRawUnsafe(CREATE_LEDGER);
  // gen_random_uuid() is built in on PostgreSQL 13+; Railway runs 16.
  await prisma.$executeRaw`
    INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
    VALUES
      (gen_random_uuid()::text, ${checksum}, now(), ${MIGRATION_NAME}, now(), 0)
  `;

  const rowsAfter = await listRows();
  return NextResponse.json({
    status: "baselined",
    migration: MIGRATION_NAME,
    checksum,
    ledgerTableExisted: ledgerExisted,
    rows: rowsAfter,
    nextStep: "Re-open this URL without ?apply=true to confirm, then the start command can switch to `prisma migrate deploy`.",
  });
}

async function tableExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

async function listRows() {
  return prisma.$queryRaw<
    Array<{ migration_name: string; checksum: string; finished_at: Date | null; applied_steps_count: number }>
  >`
    SELECT migration_name, checksum, finished_at, applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY started_at
  `;
}
