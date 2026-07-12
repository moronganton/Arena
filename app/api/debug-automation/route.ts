import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/ttlock";

// Diagnostic: checks every link of the Beds24 → reservation → PIN → email chain
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized — log in first" }, { status: 401 });

  const userId = session.user.id;

  const beds24 = await prisma.beds24Account.findUnique({ where: { userId } });
  const ttlockAccount = await prisma.tTLockAccount.findUnique({ where: { userId } });

  const mappings = await prisma.channelConfig.findMany({
    where: { channel: "BEDS24", property: { ownerId: userId } },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          locks: { select: { id: true, name: true, isActive: true, ttlockId: true } },
        },
      },
    },
  });

  let ttlockTokenOk = false;
  if (ttlockAccount) {
    try {
      ttlockTokenOk = !!(await getValidAccessToken(userId));
    } catch {
      ttlockTokenOk = false;
    }
  }

  const lastReservations = await prisma.reservation.findMany({
    where: { property: { ownerId: userId }, externalId: { startsWith: "beds24-" } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      externalId: true,
      status: true,
      createdAt: true,
      property: { select: { name: true } },
      guest: { select: { name: true, email: true } },
      accessCodes: { select: { code: true, isActive: true, sentToGuest: true } },
    },
  });

  const checks = {
    "1_beds24_connected": !!beds24,
    "2_automation_enabled": beds24?.automationEnabled ?? false,
    "3_properties_mapped": mappings.length,
    "4_mapped_properties": mappings.map((m) => ({
      stayhqProperty: m.property.name,
      beds24PropertyId: m.listingId,
      locks: m.property.locks.map((l) => ({
        name: l.name,
        active: l.isActive,
        ttlockId: l.ttlockId,
      })),
      activeLockCount: m.property.locks.filter((l) => l.isActive).length,
    })),
    "5_ttlock_account_connected": !!ttlockAccount,
    "6_ttlock_token_valid": ttlockTokenOk,
    "7_resend_email_configured": !!process.env.RESEND_API_KEY,
    "8_last_beds24_reservations": lastReservations.map((r) => ({
      externalId: r.externalId,
      property: r.property.name,
      guest: r.guest.name,
      guestEmail: r.guest.email || "MISSING — no email will be sent",
      status: r.status,
      importedAt: r.createdAt,
      accessCodes: r.accessCodes,
    })),
  };

  const problems: string[] = [];
  if (!beds24) problems.push("Beds24 not connected");
  if (beds24 && !beds24.automationEnabled) problems.push("Automation toggle is OFF — turn it on in Settings → Beds24");
  if (mappings.length === 0) problems.push("No properties mapped to Beds24");
  for (const m of mappings) {
    if (m.property.locks.filter((l) => l.isActive).length === 0) {
      problems.push(`Property "${m.property.name}" has no ACTIVE lock — codes cannot be generated for it`);
    }
  }
  if (!ttlockAccount) problems.push("TTLock account not connected — codes would be local-only");
  if (ttlockAccount && !ttlockTokenOk) problems.push("TTLock token invalid — reconnect the TTLock account in Settings → Smart Locks");
  if (!process.env.RESEND_API_KEY) problems.push("RESEND_API_KEY missing — emails cannot be sent");

  return NextResponse.json({
    verdict: problems.length === 0 ? "ALL CHECKS PASS — automation should work for the NEXT new booking" : "PROBLEMS FOUND",
    problems,
    checks,
  });
}
