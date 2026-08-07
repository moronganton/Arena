import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/ttlock";

const BASE_URL = process.env.TTLOCK_BASE_URL || "https://euapi.ttlock.com";
const CLIENT_ID = process.env.TTLOCK_CLIENT_ID || "";

// Diagnostic (read-only): answers why a passcode that shows correctly in the
// TTLock app is rejected by the physical keypad. StayHQ creates CUSTOM
// passcodes (/v3/keyboardPwd/add with our own digits), and a custom passcode
// cannot be derived by the lock from its own secret — it has to be physically
// transmitted to the lock, either over Bluetooth by a phone standing next to
// it, or remotely through a gateway. Until that happens the cloud (and the
// app) list it happily while the keypad knows nothing about it.
//
// So this reports the three things that decide it:
//   1. gateways on the account   — is remote push even possible?
//   2. lock detail              — keyboardPwdVersion + the lock's own clock
//                                 offset, since a validity window judged
//                                 against a wrong clock also reads as
//                                 "code rejected"
//   3. passcodes on the lock    — raw list, to compare against StayHQ's rows
//
//   GET /api/ttlock/debug-lock              → first active lock
//   GET /api/ttlock/debug-lock?lockId=1234  → a specific TTLock device id
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const lockIdParam = new URL(req.url).searchParams.get("lockId");

  const lock = await prisma.smartLock.findFirst({
    where: {
      property: { ownerId: session.user.id },
      ...(lockIdParam ? { ttlockId: lockIdParam } : { isActive: true }),
    },
    select: { id: true, name: true, ttlockId: true, checkInTime: true, checkOutTime: true },
  });
  if (!lock) return NextResponse.json({ error: "No matching smart lock found" }, { status: 404 });

  const accessToken = await getValidAccessToken(session.user.id);
  if (!accessToken) return NextResponse.json({ error: "TTLock account not connected" }, { status: 400 });

  async function ttlockGet(path: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({
      clientId: CLIENT_ID,
      accessToken: accessToken!,
      date: Date.now().toString(),
      ...extra,
    });
    try {
      const res = await fetch(`${BASE_URL}${path}?${params}`);
      return await res.json();
    } catch (err) {
      return { fetchError: err instanceof Error ? err.message : String(err) };
    }
  }

  const [gateways, lockDetail, passcodes] = await Promise.all([
    ttlockGet("/v3/gateway/list", { pageNo: "1", pageSize: "100" }),
    ttlockGet("/v3/lock/detail", { lockId: lock.ttlockId }),
    ttlockGet("/v3/lock/listKeyboardPwd", { lockId: lock.ttlockId, pageNo: "1", pageSize: "100" }),
  ]);

  // A gateway bound to THIS lock is what makes a remote passcode push work.
  // An account-level gateway that isn't bound to the lock does not help.
  const gatewayList: Array<Record<string, unknown>> = gateways?.list ?? [];
  const lockGateways = await ttlockGet("/v3/lock/listGateway", { lockId: lock.ttlockId });

  const storedCodes = await prisma.accessCode.findMany({
    where: { lockId: lock.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { code: true, ttlockKeyId: true, validFrom: true, validTo: true, isActive: true },
  });

  const now = Date.now();
  return NextResponse.json({
    lock: {
      stayhqName: lock.name,
      ttlockId: lock.ttlockId,
      configuredCheckIn: `${lock.checkInTime} CET`,
      configuredCheckOut: `${lock.checkOutTime} CET`,
    },
    verdict: {
      gatewayCountOnAccount: gatewayList.length,
      gatewaysBoundToThisLock: (lockGateways?.list ?? []).length,
      note:
        (lockGateways?.list ?? []).length === 0
          ? "No gateway bound to this lock: a CUSTOM passcode can only reach the keypad when a phone syncs it over Bluetooth next to the door. This is the most likely reason a code visible in the app does not open the door."
          : "A gateway is bound to this lock, so remote passcode push should work — check addType was sent and compare the lock clock below.",
    },
    // If the lock's own clock/offset disagrees with the validity window we send,
    // an otherwise-correct code reads as rejected on the keypad.
    lockClock: {
      serverNowUtc: new Date(now).toISOString(),
      lockTimezoneRawOffsetMs: lockDetail?.timezoneRawOffSet ?? null,
      keyboardPwdVersion: lockDetail?.keyboardPwdVersion ?? null,
    },
    stayhqStoredCodes: storedCodes.map((c) => ({
      ...c,
      validFrom: c.validFrom.toISOString(),
      validTo: c.validTo.toISOString(),
      activeNow: c.validFrom.getTime() <= now && c.validTo.getTime() >= now,
    })),
    rawGatewaysOnAccount: gateways,
    rawGatewaysForLock: lockGateways,
    rawLockDetail: lockDetail,
    rawPasscodesOnLock: passcodes,
  });
}
