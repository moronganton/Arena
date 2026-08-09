import bcrypt from "bcryptjs";

const ROUNDS = 12;

// Existing rows hold plaintext passwords (see the migration note in verifyPassword).
// A bcrypt hash is always 60 chars and starts with $2a$/$2b$/$2y$, so the two are
// unambiguous to tell apart — no schema flag needed to know which is which.
export function isHashed(stored: string): boolean {
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(stored);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

// Verifies a password against whatever is stored, and reports whether the stored
// value still needs upgrading.
//
// Migration: every existing account was created with a plaintext password, so a
// hard cutover would lock everyone out. Instead a plaintext row is compared
// directly this once, and the caller re-saves it as a hash on success — so
// accounts migrate silently on their next successful login and no one has to be
// told to reset anything.
export async function verifyPassword(
  plain: string,
  stored: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (isHashed(stored)) {
    return { valid: await bcrypt.compare(plain, stored), needsRehash: false };
  }
  // Legacy plaintext row — constant-time-ish compare via bcrypt is not possible
  // here, but this path exists only until the account next logs in.
  const valid = plain === stored;
  return { valid, needsRehash: valid };
}

// Minimum bar for a new password. Deliberately length-first rather than a
// symbol/number checklist: length is what actually resists guessing, and
// composition rules mostly push people toward predictable substitutions.
export function passwordProblem(plain: string): string | null {
  if (plain.length < 10) return "Password must be at least 10 characters.";
  if (/^\d+$/.test(plain)) return "Password cannot be only numbers.";
  const banned = ["demo123", "manage456", "guest789", "password", "1234567890"];
  if (banned.includes(plain.toLowerCase())) return "That password is too common — pick another.";
  return null;
}
