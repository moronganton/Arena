// Derives a 2-letter country code from a phone number's international
// dialing prefix. Used as a more useful signal than the guest's name
// initial in the Messages inbox - Guest.language exists in the schema but
// is never actually set by the live Smoobu sync (every real guest sits on
// the "en" default), so it can't be trusted to show yet. Phone numbers,
// on the other hand, are captured from every synced booking.
//
// Longest-prefix match, checked longest-first so e.g. "+420" (Czechia)
// isn't shadowed by a shorter code. Not exhaustive - covers the markets
// this host's guests actually come from plus common global ones; an
// unmatched number falls back to the guest's name initial instead of
// guessing wrong.
const CALLING_CODES: Array<[string, string]> = [
  ["+420", "CZ"], ["+421", "SK"], ["+385", "HR"], ["+386", "SI"], ["+380", "UA"],
  ["+371", "LV"], ["+370", "LT"], ["+372", "EE"], ["+351", "PT"], ["+353", "IE"],
  ["+358", "FI"], ["+972", "IL"], ["+971", "AE"],
  ["+40", "RO"], ["+36", "HU"], ["+48", "PL"], ["+43", "AT"], ["+49", "DE"],
  ["+33", "FR"], ["+39", "IT"], ["+34", "ES"], ["+31", "NL"], ["+32", "BE"],
  ["+41", "CH"], ["+44", "GB"], ["+45", "DK"], ["+46", "SE"], ["+47", "NO"],
  ["+30", "GR"], ["+90", "TR"], ["+61", "AU"], ["+64", "NZ"], ["+81", "JP"],
  ["+82", "KR"], ["+86", "CN"], ["+91", "IN"], ["+20", "EG"], ["+27", "ZA"],
  ["+55", "BR"], ["+52", "MX"], ["+54", "AR"], ["+7", "RU"], ["+1", "US"],
];

// Sorted once, longest prefix first, so a 3-digit code is tried before any
// 1- or 2-digit code that would otherwise match a shorter leading substring.
const SORTED_CODES = [...CALLING_CODES].sort((a, b) => b[0].length - a[0].length);

export function countryFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.trim().replace(/[\s()-]/g, "");
  const withPlus = normalized.startsWith("00") ? "+" + normalized.slice(2) : normalized;
  if (!withPlus.startsWith("+")) return null;
  for (const [code, country] of SORTED_CODES) {
    if (withPlus.startsWith(code)) return country;
  }
  return null;
}
