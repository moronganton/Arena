// In-memory login throttle.
//
// Scope and honest limits: this lives in the Node process, so it resets on
// deploy and would not be shared across multiple instances. StayHQ runs a
// single Railway replica, so today it genuinely covers the whole app — but if
// that ever scales to 2+ instances this must move to the database or Redis, or
// an attacker could get N times the attempts by spreading them across replicas.
//
// It exists to make online password guessing impractical, which it does even in
// this simple form: 5 attempts then a 15-minute lock takes any brute force from
// "minutes" to "geological".

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // attempts older than this are forgotten
const LOCK_MS = 15 * 60 * 1000; // how long a tripped key stays locked

interface Entry {
  failures: number[]; // timestamps of recent failures
  lockedUntil?: number;
}

const attempts = new Map<string, Entry>();

// Bound the map so a flood of distinct keys can't grow it without limit.
const MAX_KEYS = 10_000;

function prune(now: number) {
  if (attempts.size < MAX_KEYS) return;
  for (const [key, entry] of attempts) {
    const stale = (entry.lockedUntil ?? 0) < now && entry.failures.every((t) => now - t > WINDOW_MS);
    if (stale) attempts.delete(key);
  }
}

export function loginLockedFor(key: string): number | null {
  const entry = attempts.get(key);
  if (!entry?.lockedUntil) return null;
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) {
    entry.lockedUntil = undefined;
    entry.failures = [];
    return null;
  }
  return Math.ceil(remaining / 1000);
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const entry = attempts.get(key) ?? { failures: [] };
  entry.failures = entry.failures.filter((t) => now - t <= WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = [];
  }
  attempts.set(key, entry);
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
