import { prisma } from "@/lib/prisma";

const BASE_URL = process.env.TTLOCK_BASE_URL || "https://euapi.ttlock.com";
const CLIENT_ID = process.env.TTLOCK_CLIENT_ID || "";
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET || "";

interface TTLockTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface TTLockLock {
  lockId: number;
  lockName: string;
  lockAlias: string;
  electricQuantity?: number; // battery level %
}

interface TTLockPasscode {
  keyboardPwdId: number;
  keyboardPwd: string;
}

// Get OAuth token from TTLock (requires a user's credentials linked to the account)
export async function getTTLockToken(
  username: string,
  password: string
): Promise<TTLockTokenResponse & { refresh_token: string; uid?: number }> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "password",
    username,
    password: md5(password), // TTLock requires MD5 hashed password
  });

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`TTLock auth failed: ${res.status}`);
  const data = await res.json();
  // TTLock returns HTTP 200 with an errcode on invalid credentials
  if (!data.access_token) {
    throw new Error(data.errmsg || data.error_description || `TTLock login failed (code ${data.errcode ?? "unknown"})`);
  }
  return data;
}

// Link a TTLock account to a StayHQ user: authenticate and store tokens
export async function connectTTLockAccount(userId: string, username: string, password: string) {
  const token = await getTTLockToken(username, password);

  const account = await prisma.tTLockAccount.upsert({
    where: { userId },
    create: {
      userId,
      username,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      ttlockUid: token.uid ?? null,
    },
    update: {
      username,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      ttlockUid: token.uid ?? null,
    },
  });

  return account;
}

// Get a valid access token for a user, refreshing it if expired.
// Returns null if the user has not connected a TTLock account.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.tTLockAccount.findUnique({ where: { userId } });
  if (!account) return null;

  // Still valid for at least 5 more minutes
  if (account.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return account.accessToken;
  }

  // Refresh
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  });

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (!data.access_token) {
    // Refresh failed — user needs to reconnect
    console.error("TTLock token refresh failed:", data);
    return null;
  }

  await prisma.tTLockAccount.update({
    where: { userId },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return data.access_token;
}

// List all locks for an account
export async function listTTLocks(accessToken: string): Promise<TTLockLock[]> {
  const params = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken,
    pageNo: "1",
    pageSize: "100",
    date: Date.now().toString(),
  });

  const res = await fetch(`${BASE_URL}/v3/lock/list?${params}`);
  if (!res.ok) throw new Error(`Failed to list locks: ${res.status}`);
  const data = await res.json();
  return data.list || [];
}

// Generate a custom passcode for a reservation
export async function createPasscode(
  accessToken: string,
  lockId: string,
  passcode: string,
  validFrom: Date,
  validTo: Date,
  name?: string
): Promise<TTLockPasscode> {
  const params = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken,
    lockId,
    keyboardPwdType: "3", // 3 = custom, 4 = periodic
    keyboardPwd: passcode,
    startDate: validFrom.getTime().toString(),
    endDate: validTo.getTime().toString(),
    date: Date.now().toString(),
  });
  // Passcode name shown in the TTLock app (e.g. the guest's name).
  // Keep letters (incl. accents), digits, spaces, hyphens, apostrophes; strip emoji/symbols.
  if (name) {
    const safeName = name.replace(/[^\p{L}\p{N}\s'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (safeName) params.set("keyboardPwdName", safeName);
  }

  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/add`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Failed to create passcode: ${res.status}`);
  const data = await res.json();
  // Success responses contain keyboardPwdId and may omit errcode entirely;
  // failure responses contain a non-zero errcode.
  if (!data.keyboardPwdId) {
    throw new Error(`TTLock error ${data.errcode ?? "?"}: ${data.errmsg || JSON.stringify(data)}`);
  }
  return { keyboardPwdId: data.keyboardPwdId, keyboardPwd: passcode };
}

// List passcodes currently on a lock (used to find codes we lost track of)
export async function listPasscodes(
  accessToken: string,
  lockId: string
): Promise<Array<{ keyboardPwdId: number; keyboardPwd: string }>> {
  const params = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken,
    lockId,
    pageNo: "1",
    pageSize: "100",
    date: Date.now().toString(),
  });

  const res = await fetch(`${BASE_URL}/v3/lock/listKeyboardPwd?${params}`);
  if (!res.ok) throw new Error(`Failed to list passcodes: ${res.status}`);
  const data = await res.json();
  return data.list || [];
}

// Change the validity period of an existing passcode (requires a gateway)
export async function changePasscodePeriod(
  accessToken: string,
  lockId: string,
  keyboardPwdId: string,
  validFrom: Date,
  validTo: Date
): Promise<void> {
  const params = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken,
    lockId,
    keyboardPwdId,
    startDate: validFrom.getTime().toString(),
    endDate: validTo.getTime().toString(),
    changeType: "2", // 2 = via gateway
    date: Date.now().toString(),
  });

  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/change`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Failed to change passcode period: HTTP ${res.status}`);
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`TTLock change error ${data.errcode}: ${data.errmsg || "unknown"}`);
  }
}

// Delete a passcode
export async function deletePasscode(
  accessToken: string,
  lockId: string,
  keyboardPwdId: string
): Promise<void> {
  const params = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken,
    lockId,
    keyboardPwdId,
    deleteType: "2", // 2 = delete from lock
    date: Date.now().toString(),
  });

  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Failed to delete passcode: HTTP ${res.status}`);
  // TTLock returns HTTP 200 with an errcode on failure
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`TTLock delete error ${data.errcode}: ${data.errmsg || "unknown"}`);
  }
}

// Generate a random 4-digit code
function generateRandomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Main function: generate code + save to DB + email guest
export async function generateAccessCode(params: {
  lockId: string;
  reservationId: string;
  validFrom: Date;
  validTo: Date;
  accessToken?: string;
}): Promise<string> {
  const lock = await prisma.smartLock.findUnique({
    where: { id: params.lockId },
    include: { property: { select: { ownerId: true } } },
  });
  if (!lock) throw new Error("Lock not found");

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: { guest: true, property: true },
  });
  if (!reservation) throw new Error("Reservation not found");

  const code = generateRandomCode();
  let ttlockKeyId: string | undefined;

  // Get an access token: either passed in, or from the owner's linked TTLock account
  const accessToken =
    params.accessToken || (await getValidAccessToken(lock.property.ownerId));

  // If TTLock is connected, push to the physical lock
  if (accessToken && lock.ttlockId) {
    try {
      const result = await createPasscode(
        accessToken,
        lock.ttlockId,
        code,
        params.validFrom,
        params.validTo,
        reservation.guest.name
      );
      ttlockKeyId = result.keyboardPwdId.toString();
    } catch (err) {
      console.error("TTLock API error (code saved locally only):", err);
    }
  }

  const accessCode = await prisma.accessCode.create({
    data: {
      code,
      ttlockKeyId,
      validFrom: params.validFrom,
      validTo: params.validTo,
      lockId: params.lockId,
      reservationId: params.reservationId,
    },
  });

  console.log(`[codes] access code generated for reservation ${params.reservationId}: ${code} (valid ${params.validFrom.toISOString()} to ${params.validTo.toISOString()})`);

  return code;
}

// Parse time string (HH:mm) and apply to a date in CET timezone
function applyTimeToDateCET(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);

  // Create a formatter for CET to get the offset
  const cetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', // CET/CEST timezone
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Get the CET date parts for our input date
  const cetParts = cetFormatter.formatToParts(date);
  const cetYear = parseInt(cetParts.find(p => p.type === 'year')!.value);
  const cetMonth = parseInt(cetParts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
  const cetDay = parseInt(cetParts.find(p => p.type === 'day')!.value);

  // Create a new date in UTC that represents the desired CET time
  // First, create a UTC date for the CET date at 00:00
  const utcMidnight = new Date(Date.UTC(cetYear, cetMonth, cetDay, 0, 0, 0, 0));

  // Get the offset between UTC and CET for this date (handles DST)
  const cetMidnightStr = cetFormatter.format(utcMidnight);
  const cetMidnightParts = cetFormatter.formatToParts(utcMidnight);
  const cetMidnightHour = parseInt(cetMidnightParts.find(p => p.type === 'hour')!.value);
  const offset = cetMidnightHour; // Hours offset from UTC

  // Create the target UTC time by subtracting the offset
  const result = new Date(Date.UTC(cetYear, cetMonth, cetDay, hours - offset, minutes, 0, 0));

  return result;
}

// Generate access codes for every active lock on a property (used on new reservations)
export async function autoGenerateCodesForReservation(
  reservationId: string,
  propertyId: string
): Promise<{ codes: string[]; errors: string[] }> {
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return { codes: [], errors: ["Reservation not found"] };

  const locks = await prisma.smartLock.findMany({
    where: { propertyId, isActive: true },
  });
  console.log(`[codes] property ${propertyId}: found ${locks.length} active lock(s) for reservation ${reservationId}`);

  const codes: string[] = [];
  const errors: string[] = [];
  for (const lock of locks) {
    try {
      const validFrom = applyTimeToDateCET(reservation.checkIn, lock.checkInTime);
      const validTo = applyTimeToDateCET(reservation.checkOut, lock.checkOutTime);
      const code = await generateAccessCode({
        lockId: lock.id,
        reservationId,
        validFrom,
        validTo,
      });
      codes.push(code);
    } catch (err) {
      errors.push(`Lock ${lock.name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`Auto code generation failed for lock ${lock.id}:`, err);
    }
  }
  return { codes, errors };
}

// Deactivate all access codes for a reservation and remove them from the physical locks.
// Returns a report so failures can be surfaced instead of hidden.
export async function revokeAccessCodesForReservation(reservationId: string, ownerId: string) {
  const codes = await prisma.accessCode.findMany({
    where: { reservationId, isActive: true },
    include: { lock: true },
  });
  if (codes.length === 0) return { revoked: 0, lockErrors: [] as string[] };

  const accessToken = await getValidAccessToken(ownerId);
  const lockErrors: string[] = [];

  for (const code of codes) {
    if (code.lock.ttlockId) {
      if (!accessToken) {
        lockErrors.push(`Code ${code.code}: TTLock account not connected — code was NOT removed from the lock`);
      } else {
        try {
          let keyId = code.ttlockKeyId;
          if (!keyId) {
            const onLock = await listPasscodes(accessToken, code.lock.ttlockId);
            const match = onLock.find((p) => p.keyboardPwd === code.code);
            keyId = match ? String(match.keyboardPwdId) : null;
          }
          if (keyId) {
            await deletePasscode(accessToken, code.lock.ttlockId, keyId);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lockErrors.push(`Code ${code.code} on "${code.lock.name}": ${msg}`);
          console.error(`Failed to delete passcode ${code.id} from lock:`, err);
        }
      }
    }
    await prisma.accessCode.update({ where: { id: code.id }, data: { isActive: false } });
  }

  return { revoked: codes.length, lockErrors };
}

// Update the validity period of all active access codes for a reservation,
// both on the physical locks and in the database.
// Push one code's new validity window to the physical lock. Returns an error
// string to surface to the host, or null on success. Shared by the whole-stay
// update (dates changed on the booking) and the per-code edit (early check-in /
// late check-out for a single door).
async function applyCodePeriodOnLock(
  code: { id: string; code: string; ttlockKeyId: string | null; lock: { ttlockId: string | null; name: string } },
  accessToken: string | null,
  validFrom: Date,
  validTo: Date,
  guestName?: string
): Promise<string | null> {
  if (!code.lock.ttlockId) return null; // not a physical lock — DB update is enough

  if (!accessToken) {
    return `Code ${code.code}: TTLock account not connected — validity was NOT updated on the lock`;
  }

  try {
    let keyId = code.ttlockKeyId;
    if (!keyId) {
      const onLock = await listPasscodes(accessToken, code.lock.ttlockId);
      const match = onLock.find((p) => p.keyboardPwd === code.code);
      keyId = match ? String(match.keyboardPwdId) : null;
      if (keyId) {
        await prisma.accessCode.update({ where: { id: code.id }, data: { ttlockKeyId: keyId } });
      }
    }
    if (!keyId) {
      return `Code ${code.code}: not found on lock "${code.lock.name}" — validity not updated`;
    }

    try {
      await changePasscodePeriod(accessToken, code.lock.ttlockId, keyId, validFrom, validTo);
    } catch (err) {
      // TTLock error -3008: a passcode never used on the lock can't be changed.
      // Workaround: delete it and re-create the same digits with the new period.
      if (err instanceof Error && err.message.includes("-3008")) {
        await deletePasscode(accessToken, code.lock.ttlockId, keyId);
        const recreated = await createPasscode(
          accessToken,
          code.lock.ttlockId,
          code.code,
          validFrom,
          validTo,
          guestName
        );
        await prisma.accessCode.update({
          where: { id: code.id },
          data: { ttlockKeyId: String(recreated.keyboardPwdId) },
        });
      } else {
        throw err;
      }
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to update passcode period for ${code.id}:`, err);
    return `Code ${code.code} on "${code.lock.name}": ${msg}`;
  }
}

// Change the validity window of ONE existing code — an early check-in or a late
// check-out normally affects a single door, not the whole stay.
export async function updateAccessCodeValidity(
  accessCodeId: string,
  ownerId: string,
  validFrom: Date,
  validTo: Date
): Promise<{ ok: boolean; lockError: string | null }> {
  const code = await prisma.accessCode.findFirst({
    where: { id: accessCodeId, reservation: { property: { ownerId } } },
    include: { lock: true, reservation: { include: { guest: true } } },
  });
  if (!code) throw new Error("Access code not found");

  const accessToken = await getValidAccessToken(ownerId);
  const lockError = await applyCodePeriodOnLock(
    code,
    accessToken,
    validFrom,
    validTo,
    code.reservation.guest.name
  );

  // Keep StayHQ in step with the lock even when the push failed, so the record
  // reflects what the host asked for and the error is reported rather than
  // silently discarded.
  await prisma.accessCode.update({
    where: { id: code.id },
    data: { validFrom, validTo },
  });

  return { ok: lockError === null, lockError };
}

export async function updateAccessCodePeriodsForReservation(
  reservationId: string,
  ownerId: string,
  validFrom: Date,
  validTo: Date
): Promise<string[]> {
  const codes = await prisma.accessCode.findMany({
    where: { reservationId, isActive: true },
    include: { lock: true },
  });
  if (codes.length === 0) return [];

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { guest: true },
  });

  const accessToken = await getValidAccessToken(ownerId);
  const lockErrors: string[] = [];

  for (const code of codes) {
    const lockError = await applyCodePeriodOnLock(
      code,
      accessToken,
      validFrom,
      validTo,
      reservation?.guest.name
    );
    if (lockError) {
      lockErrors.push(lockError);
      continue; // leave the stored window alone when the lock rejected the change
    }
    await prisma.accessCode.update({
      where: { id: code.id },
      data: { validFrom, validTo },
    });
  }

  return lockErrors;
}

// Simple MD5 for TTLock (they require this)
function md5(str: string): string {
  // In production, use the `crypto` module or a proper md5 library
  // For now, return a placeholder — install `md5` package for real use
  const crypto = require("crypto");
  return crypto.createHash("md5").update(str).digest("hex");
}
