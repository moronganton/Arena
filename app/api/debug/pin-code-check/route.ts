import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Diagnoses why specific reservations never got an auto-generated access
// code. Two silent paths produce exactly this symptom:
//   1. SmoobuAccount.automationEnabled is off - autoGenerateCodesForReservation
//      is never even called for new bookings synced from Smoobu (see the
//      `if (automationEnabled)` gate in lib/channels/smoobu.ts).
//   2. The property has zero active SmartLock rows - the function runs, loops
//      over zero locks, and returns { codes: [], errors: [] }: not an error,
//      just nothing to generate against.
//
//   GET /api/debug/pin-code-check?guests=Tayler Stewart,Iga Smulska,...
//   GET /api/debug/pin-code-check?upcoming=true   -> every not-yet-checked-out
//                                                     reservation account-wide,
//                                                     any source or status
//                                                     that still needs a code
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const guestsParam = searchParams.get("guests");
  const upcoming = searchParams.get("upcoming") === "true";
  const guestNames = guestsParam
    ? guestsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const account = await prisma.smoobuAccount.findUnique({
    where: { userId: session.user.id },
    select: { automationEnabled: true },
  });

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session.user.id },
      ...(guestNames.length
        ? { guest: { name: { in: guestNames } } }
        : upcoming
          ? { checkOut: { gte: new Date() }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }
          : { source: "BOOKING", status: "CONFIRMED" }),
    },
    select: {
      id: true,
      confirmationCode: true,
      externalId: true,
      checkIn: true,
      checkOut: true,
      createdAt: true,
      status: true,
      guest: { select: { name: true } },
      property: {
        select: {
          id: true,
          name: true,
          locks: { where: { isActive: true }, select: { id: true, name: true, ttlockId: true } },
        },
      },
      accessCodes: { select: { id: true, code: true, isActive: true, createdAt: true } },
    },
    orderBy: upcoming ? { checkIn: "asc" } : { createdAt: "desc" },
    take: guestNames.length || upcoming ? undefined : 30,
  });

  const rows = reservations.map((r) => ({
    guest: r.guest.name,
    property: r.property.name,
    checkIn: r.checkIn.toISOString().slice(0, 10),
    checkOut: r.checkOut.toISOString().slice(0, 10),
    createdAt: r.createdAt.toISOString(),
    activeLocksOnProperty: r.property.locks.length,
    lockNames: r.property.locks.map((l) => l.name),
    accessCodeCount: r.accessCodes.length,
    hasCode: r.accessCodes.length > 0,
    likelyCause:
      r.accessCodes.length > 0
        ? "has a code - not affected"
        : account?.automationEnabled === false
          ? "automationEnabled is OFF on the Smoobu account"
          : r.property.locks.length === 0
            ? "property has ZERO active SmartLock rows"
            : "unclear - has active lock(s) and automation is on, but no code exists (check server logs for this reservation's id)",
  }));

  return NextResponse.json({
    automationEnabled: account?.automationEnabled ?? null,
    smoobuAccountConnected: !!account,
    checked: rows.length,
    missingCodeCount: rows.filter((r) => !r.hasCode).length,
    // Surfaced separately so a large upcoming-reservations list doesn't bury
    // the rows that actually need attention under the ones that are fine.
    missingRows: rows.filter((r) => !r.hasCode),
    rows,
  });
}
