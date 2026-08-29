import { validateRatePlanSet, type RatePlanSpec } from "./channels/rate-plan-spec";

// Turning "a screenshot of the Booking.com rate plans page" into a rate plan
// family this app can actually create.
//
// The extraction itself is a model call (see the import route). Everything
// that decides whether the result is USABLE lives here, pure and tested,
// because the failure mode that matters is not a crashed request - it is a
// plausible-looking set of plans that quietly prices the property wrong.
//
// Two things this deliberately refuses to do:
//
//   1. Invent a minimum stay. Booking.com's rate plan page says "No minimum
//      length of stay" and "Managed by your Calendar" - the number genuinely
//      is not on that screen. A suggestion is offered and marked as a
//      suggestion; it is never presented as something that was read.
//   2. Accept a set it cannot build. Channex needs exactly one parent and
//      unique titles; a screenshot of six plans where two share a name, or
//      none is the base, must be reported before anything is created.

/** What the model is asked to return, before any normalisation. */
export interface RawExtractedPlan {
  title?: unknown;
  percentOfStandard?: unknown; // negative = cheaper, positive = dearer, 0/null = the base
  isStandard?: unknown;
  minStay?: unknown;
  cancellationPolicy?: unknown;
  readMinStay?: unknown; // true only when a minimum was genuinely visible
}

export interface ImportedPlan extends RatePlanSpec {
  /** Present on the screenshot but not storable yet - surfaced, never dropped. */
  cancellationPolicy: string | null;
  /** False when minStayArrival is host24's suggestion rather than something read. */
  minStayWasRead: boolean;
}

export interface ImportResult {
  plans: ImportedPlan[];
  /** Blocking - the set cannot be created until these are resolved. */
  problems: string[];
  /** Non-blocking - worth the operator's eye before they press create. */
  warnings: string[];
}

/**
 * Minimum stays host24 proposes when the screenshot does not carry one.
 * Keyed on the words operators actually use, because a plan called "Weekly
 * Rate" that sells single nights is almost certainly a transcription gap
 * rather than an intention.
 */
export function suggestMinStay(title: string): { minStay: number; reason: string | null } {
  const t = title.toLowerCase();
  if (/\bmonth/.test(t)) return { minStay: 28, reason: "monthly rates usually need 28 nights" };
  if (/\bweek/.test(t)) return { minStay: 7, reason: "weekly rates usually need 7 nights" };
  const days = t.match(/\b(\d+)\s*(?:day|night)/);
  if (days) {
    const n = Number(days[1]);
    if (n >= 1 && n <= 30) return { minStay: n, reason: `the name says ${n}` };
  }
  return { minStay: 1, reason: null };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asPercent(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // "10% cheaper", "-10", "+20%" - the screenshot phrases it in prose.
    const m = v.match(/(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return /cheaper|less|discount|off\b/i.test(v) ? -Math.abs(n) : n;
  }
  return null;
}

/**
 * Normalise whatever the model returned into a family this app can create,
 * with every uncertainty stated rather than smoothed over.
 */
export function normalizeExtraction(raw: unknown): ImportResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) {
    return { plans: [], problems: ["No rate plans could be read from that image."], warnings };
  }

  const plans: ImportedPlan[] = [];
  for (const item of list as RawExtractedPlan[]) {
    const title = asString(item?.title);
    if (!title) {
      warnings.push("A row was skipped because it had no readable name.");
      continue;
    }

    const isStandard = item?.isStandard === true;
    const pct = asPercent(item?.percentOfStandard);
    // The parent is defined by the ABSENCE of a percentage, which is also how
    // rate-plan-spec decides. A "0%" child would be a duplicate of its parent.
    const derivedPercent = isStandard || pct === null || pct === 0 ? null : pct;

    const readMin = item?.readMinStay === true;
    const rawMin = typeof item?.minStay === "number" ? Math.trunc(item.minStay) : null;
    let minStayArrival: number;
    let minStayWasRead: boolean;

    if (readMin && rawMin !== null && rawMin >= 1) {
      minStayArrival = rawMin;
      minStayWasRead = true;
    } else {
      const s = suggestMinStay(title);
      minStayArrival = s.minStay;
      minStayWasRead = false;
      if (s.reason) warnings.push(`"${title}": minimum stay set to ${s.minStay} because ${s.reason}. Check it.`);
    }

    plans.push({
      title,
      derivedPercent,
      minStayArrival,
      cancellationPolicy: asString(item?.cancellationPolicy),
      minStayWasRead,
    });
  }

  if (plans.length === 0) {
    return { plans, problems: ["No rate plans could be read from that image."], warnings };
  }

  // A screenshot rarely arrives in provisioning order, and the parent must be
  // created before anything deriving from it.
  const parentIndex = plans.findIndex((p) => p.derivedPercent === null);
  if (parentIndex > 0) plans.unshift(...plans.splice(parentIndex, 1));

  const parents = plans.filter((p) => p.derivedPercent === null);
  if (parents.length === 0) {
    problems.push(
      "None of these looks like your main rate. One plan must be the standard rate that the others are a percentage of."
    );
  } else if (parents.length > 1) {
    problems.push(
      `${parents.length} plans have no percentage, so host24 cannot tell which is your main rate: ${parents
        .map((p) => `"${p.title}"`)
        .join(", ")}.`
    );
  }

  if (!plans.some((p) => p.cancellationPolicy)) {
    // Silence here is fine; noise is not.
  } else {
    warnings.push(
      "Cancellation policies were read from your screenshot but host24 cannot store them yet - they stay as they are on Booking.com."
    );
  }

  // Reuse the same validator provisioning uses, so a set that passes here
  // cannot fail for a structural reason at create time.
  problems.push(...validateRatePlanSet(plans));

  return { plans, problems, warnings };
}
