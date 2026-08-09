import crypto from "crypto";

// Password reset codes, held in memory.
//
// Chosen over a database table for now, deliberately: no schema change. The
// tradeoff is real and worth stating — a Railway redeploy mid-reset silently
// invalidates an outstanding code, and this would not work across more than one
// instance. Both are the same limitation the login throttle carries. Move this
// to a table before onboarding external Property Owners in Phase 2, when people
// who cannot ask you directly start needing it.
//
// Unlike the login throttle, losing this state is harmless: the user just
// requests another code.

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Independent of the login throttle: this limits how often a code can be SENT,
// so the endpoint cannot be used to bomb an inbox or burn the Resend quota.
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;

interface Entry {
  // Stored hashed, so the in-memory value is not itself a usable credential.
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

const codes = new Map<string, Entry>(); // key: lowercased email
const sends = new Map<string, number[]>(); // key: lowercased email -> timestamps

function hash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function sixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

// True when this address has asked for too many codes recently. Checked before
// any email is sent, and deliberately NOT surfaced differently to the caller —
// the endpoint answers identically either way so it cannot be used to probe
// which addresses exist.
export function sendLimitReached(email: string): boolean {
  const now = Date.now();
  const recent = (sends.get(email) ?? []).filter((t) => now - t <= SEND_WINDOW_MS);
  sends.set(email, recent);
  return recent.length >= MAX_SENDS_PER_WINDOW;
}

export function recordSend(email: string): void {
  const now = Date.now();
  const recent = (sends.get(email) ?? []).filter((t) => now - t <= SEND_WINDOW_MS);
  recent.push(now);
  sends.set(email, recent);
}

export function createResetCode(email: string): string {
  const code = sixDigitCode();
  codes.set(email, { codeHash: hash(code), expiresAt: Date.now() + TTL_MS, attempts: 0 });
  return code;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "none" | "expired" | "mismatch" | "too_many" };

// Verifies and CONSUMES the code on success, so a reset link cannot be replayed.
export function consumeResetCode(email: string, code: string): VerifyResult {
  const entry = codes.get(email);
  if (!entry) return { ok: false, reason: "none" };

  if (Date.now() > entry.expiresAt) {
    codes.delete(email);
    return { ok: false, reason: "expired" };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    codes.delete(email);
    return { ok: false, reason: "too_many" };
  }

  const supplied = hash(code.trim());
  const expected = entry.codeHash;
  // Constant-time compare: both are fixed-length sha256 hex, so lengths match.
  const match = crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!match) {
    entry.attempts++;
    return { ok: false, reason: "mismatch" };
  }

  codes.delete(email);
  return { ok: true };
}
