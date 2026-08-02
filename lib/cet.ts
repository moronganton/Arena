// Property-local time helpers. Lock validity is always expressed in CET/CEST
// (Europe/Berlin) regardless of where the host's browser or the server runs, so
// every conversion between a wall-clock time the host types and the UTC instant
// stored on the code goes through here.

const TZ = "Europe/Berlin";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoneParts(at: Date) {
  const parts = partsFormatter.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl renders midnight as hour 24 in some ICU versions; normalise it.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

// Minutes Europe/Berlin is ahead of UTC at this instant (+60 CET, +120 CEST).
function offsetMinutes(at: Date): number {
  const p = zoneParts(at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - at.getTime()) / 60000);
}

// A UTC instant → the "YYYY-MM-DDTHH:mm" string a datetime-local input expects,
// showing the CET wall-clock time the guest will actually experience.
export function toCetInputValue(d: Date): string {
  const p = zoneParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// "YYYY-MM-DDTHH:mm" typed by the host, read as CET wall-clock → UTC instant.
// Resolved iteratively because the correct offset depends on the very instant
// being computed, which matters across the March/October DST switches.
export function cetInputValueToUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as unknown as number[];

  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let ts = naive - offsetMinutes(new Date(naive)) * 60000;
  ts = naive - offsetMinutes(new Date(ts)) * 60000; // settle DST boundaries
  const result = new Date(ts);
  return Number.isNaN(result.getTime()) ? null : result;
}

// Human-readable CET timestamp for display, e.g. "5 Oct 2026, 14:00".
export function formatCet(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
