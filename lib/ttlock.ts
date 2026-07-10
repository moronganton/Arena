import { prisma } from "@/lib/prisma";
import { sendAccessCodeEmail } from "@/lib/notifications";

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
  // Passcode name shown in the TTLock app (e.g. the guest's name)
  if (name) params.set("keyboardPwdName", name.slice(0, 20));

  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/add`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Failed to create passcode: ${res.status}`);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`TTLock error: ${data.errmsg}`);
  return { keyboardPwdId: data.keyboardPwdId, keyboardPwd: passcode };
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

  if (!res.ok) throw new Error(`Failed to delete passcode: ${res.status}`);
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

  // Send code to guest via email
  if (reservation.guest.email) {
    await sendAccessCodeEmail({
      guestName: reservation.guest.name,
      guestEmail: reservation.guest.email,
      propertyName: reservation.property.name,
      code,
      validFrom: params.validFrom,
      validTo: params.validTo,
    });

    await prisma.accessCode.update({
      where: { id: accessCode.id },
      data: { sentToGuest: true, sentAt: new Date() },
    });
  }

  return code;
}

// Simple MD5 for TTLock (they require this)
function md5(str: string): string {
  // In production, use the `crypto` module or a proper md5 library
  // For now, return a placeholder — install `md5` package for real use
  const crypto = require("crypto");
  return crypto.createHash("md5").update(str).digest("hex");
}
