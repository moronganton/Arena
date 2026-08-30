import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// The recent ARI pushes for a property, newest first, with the Channex task
// ids each one produced.
//
// Certification grades every scenario on a task id, and most scenarios are
// ordinary app actions - change a price, set a minimum stay, close a date -
// which go through the outbox rather than a button that reports back. Without
// this the ids exist only in the drain's return value and are gone by the time
// anyone looks.
//
// Read-only. It reports on pushes the app already made from its own UI.
//
//   GET /api/debug/ari-pushes?propertyId=...&limit=10
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const params = new URL(req.url).searchParams;
  const propertyId = params.get("propertyId");
  const limit = Math.min(Number(params.get("limit") ?? 10) || 10, 50);

  const rows = await prisma.ariOutbox.findMany({
    where: propertyId ? { propertyId } : {},
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true, kind: true, status: true, dateFrom: true, dateTo: true,
      attempts: true, lastError: true, taskIds: true, createdAt: true, updatedAt: true,
      property: { select: { name: true } },
    },
  });

  return NextResponse.json({
    pushes: rows.map((r) => ({
      property: r.property.name,
      kind: r.kind,
      status: r.status,
      nights: `${r.dateFrom.toISOString().slice(0, 10)} → ${r.dateTo.toISOString().slice(0, 10)}`,
      // A row settled before this column existed has none, which is not the
      // same as a push that returned none.
      taskIds: r.taskIds ? (JSON.parse(r.taskIds) as string[]) : null,
      attempts: r.attempts,
      lastError: r.lastError,
      queuedAt: r.createdAt,
      settledAt: r.updatedAt,
    })),
  });
}
