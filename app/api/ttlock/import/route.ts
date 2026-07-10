import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, listTTLocks } from "@/lib/ttlock";

// GET — list locks from the linked TTLock cloud account
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken(session.user.id);
  if (!accessToken) {
    return NextResponse.json(
      { error: "TTLock account not connected. Connect it first." },
      { status: 400 }
    );
  }

  try {
    const cloudLocks = await listTTLocks(accessToken);

    // Mark locks already imported
    const existing = await prisma.smartLock.findMany({
      where: { property: { ownerId: session.user.id } },
      select: { ttlockId: true },
    });
    const existingIds = new Set(existing.map((l) => l.ttlockId));

    return NextResponse.json(
      cloudLocks.map((l) => ({
        ttlockId: String(l.lockId),
        name: l.lockAlias || l.lockName,
        batteryLevel: l.electricQuantity ?? null,
        imported: existingIds.has(String(l.lockId)),
      }))
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch locks from TTLock" },
      { status: 500 }
    );
  }
}

// POST — import selected locks, assigning each to a property
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { locks } = await req.json();
  if (!Array.isArray(locks) || locks.length === 0) {
    return NextResponse.json({ error: "No locks to import" }, { status: 400 });
  }

  let imported = 0;
  for (const l of locks) {
    if (!l.ttlockId || !l.propertyId) continue;

    // Verify property ownership
    const property = await prisma.property.findFirst({
      where: { id: l.propertyId, ownerId: session.user.id },
    });
    if (!property) continue;

    await prisma.smartLock.upsert({
      where: { ttlockId: String(l.ttlockId) },
      create: {
        ttlockId: String(l.ttlockId),
        name: l.name || "Smart Lock",
        batteryLevel: l.batteryLevel ?? null,
        lockType: "PIN",
        propertyId: l.propertyId,
      },
      update: {
        name: l.name || undefined,
        batteryLevel: l.batteryLevel ?? undefined,
        propertyId: l.propertyId,
        isActive: true,
      },
    });
    imported++;
  }

  return NextResponse.json({ imported });
}
