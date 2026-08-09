import crypto from "crypto";

// Pending email changes, held in memory only.
//
// Why not a database table: changing the login email is the one operation that
// can lock you out of your own account — a typo becomes an address you can't
// receive mail at, and credentials login IS the email. So the new address must
// prove it can receive mail BEFORE the change applies. A short-lived in-memory
// code is enough for that: the whole flow takes a minute, and if the process
// restarts mid-flow the change simply doesn't happen, which is the safe outcome.
//
// Same single-replica caveat as the login throttle. Unlike the throttle, losing
// this state costs nothing — the user just requests a new code.

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface Pending {
  newEmail: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

const pending = new Map<string, Pending>();

function sixDigitCode(): string {
  // crypto rather than Math.random: this code authorises an account change.
  return String(crypto.randomInt(100000, 1000000));
}

export function startEmailChange(userId: string, newEmail: string): string {
  const code = sixDigitCode();
  pending.set(userId, { newEmail, code, expiresAt: Date.now() + TTL_MS, attempts: 0 });
  return code;
}

export function peekEmailChange(userId: string): { newEmail: string } | null {
  const entry = pending.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pending.delete(userId);
    return null;
  }
  return { newEmail: entry.newEmail };
}

export type ConfirmResult =
  | { ok: true; newEmail: string }
  | { ok: false; reason: "none" | "expired" | "mismatch" | "too_many" };

export function confirmEmailChange(userId: string, code: string): ConfirmResult {
  const entry = pending.get(userId);
  if (!entry) return { ok: false, reason: "none" };

  if (Date.now() > entry.expiresAt) {
    pending.delete(userId);
    return { ok: false, reason: "expired" };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    pending.delete(userId);
    return { ok: false, reason: "too_many" };
  }

  if (entry.code !== code.trim()) {
    entry.attempts++;
    return { ok: false, reason: "mismatch" };
  }

  pending.delete(userId);
  return { ok: true, newEmail: entry.newEmail };
}

export function cancelEmailChange(userId: string): void {
  pending.delete(userId);
}
