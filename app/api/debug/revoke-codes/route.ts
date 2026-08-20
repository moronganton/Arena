import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { revokeAccessCodesForReservation } from "@/lib/ttlock";

// Revokes door codes for a property's reservations without touching the
// reservations themselves.
//
// Dry run by default. Nothing changes unless ?apply=true is passed.
//
//   GET /api/debug/revoke-codes?propertyId=xxx
//   GET /api/debug/revoke-codes?propertyId=xxx&writer=channex&apply=true
//
// Written for certification testing: a test hotel's bookings flow into a
// real apartment, and every one programs a PIN on the real lock. The
// bookings themselves are the evidence a certification run is judged on and
// must stay; the codes on the door should not.
//
// Only ACTIVE codes are considered - an already-revoked code needs nothing
// doing. Codes are removed from the physical lock, not merely marked
// inactive in the database, and a lock that refuses is reported rather than
// swallowed, because a code the lock kept is still a code that opens a door.

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "true";
  const propertyId = searchParams.get("propertyId");
  // e.g. "channex" to limit this to bookings that came from Channex, leaving
  // codes belonging to real guests from other sources alone.
  const writer = searchParams.get("writer");

  if (!propertyId) {
    const properties = await prisma.property.findMany({
      where: { ownerId: access.userId },
      select: {
        id: true,
        name: true,
        channelProvider: true,
        locks: { select: { name: true, ttlockId: true } },
      },
    });
    return NextResponse.json({
      error: "propertyId is required - pick one below and re-run",
      properties: properties.map((p) => ({
        propertyId: p.id,
        name: p.name,
        channelProvider: p.channelProvider,
        locks: p.locks.map((l) => ({ name: l.name, isPhysical: !!l.ttlockId })),
      })),
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: access.userId },
    select: { id: true, name: true, ownerId: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const reservations = await prisma.reservation.findMany({
    where: {
      propertyId: property.id,
      ...(writer ? { externalId: { startsWith: writer } } : {}),
      accessCodes: { some: { isActive: true } },
    },
    select: {
      id: true,
      externalId: true,
      checkIn: true,
      checkOut: true,
      guest: { select: { name: true } },
      accessCodes: {
        where: { isActive: true },
        select: { id: true, ttlockKeyId: true, validFrom: true, validTo: true, lock: { select: { name: true, ttlockId: true } } },
      },
    },
    orderBy: { checkIn: "asc" },
  });

  const plan = reservations.map((r) => ({
    reservationId: r.id,
    guest: r.guest.name,
    stay: `${r.checkIn.toISOString().slice(0, 10)} -> ${r.checkOut.toISOString().slice(0, 10)}`,
    externalId: r.externalId,
    activeCodes: r.accessCodes.length,
    onPhysicalLock: r.accessCodes.filter((c) => c.lock.ttlockId && c.ttlockKeyId).length,
    locks: [...new Set(r.accessCodes.map((c) => c.lock.name))],
  }));

  const totalCodes = plan.reduce((n, p) => n + p.activeCodes, 0);

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing has been changed",
      property: property.name,
      writerFilter: writer ?? "(none - every source on this property)",
      reservationsAffected: plan.length,
      activeCodesToRevoke: totalCodes,
      codesOnPhysicalLocks: plan.reduce((n, p) => n + p.onPhysicalLock, 0),
      note: "The reservations themselves are NOT touched - only their door codes.",
      hint: "Re-run with &apply=true to revoke.",
      plan,
    });
  }

  let revoked = 0;
  const errors: string[] = [];

  for (const r of reservations) {
    try {
      const res = await revokeAccessCodesForReservation(r.id, property.ownerId);
      revoked += res.revoked;
      if (res.lockErrors.length) errors.push(`${r.guest.name}: ${res.lockErrors.join("; ")}`);
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    mode: "applied - codes revoked, reservations kept",
    property: property.name,
    reservationsProcessed: reservations.length,
    codesRevoked: revoked,
    errors,
  });
}
