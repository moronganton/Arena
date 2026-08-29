import { derivationOf, validateRatePlanSet, type RatePlanSpec } from "./channels/rate-plan-spec";

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
  amountOfStandard?: unknown; // the same, stated in money instead of percent
  mealPlan?: unknown; // "Breakfast" / "No meals"
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
  /**
   * True for a plan known to be priced against the main rate, where the source
   * did not say by how much - a child missing its one number, not a parent.
   * Only the channel read sets this; a screenshot either shows a percentage or
   * shows nothing.
   */
  needsPercent?: boolean;
}

/**
 * Everything blocking about a proposed family, recomputed from the plans
 * themselves.
 *
 * This is shared with the review screen deliberately. Problems used to be
 * decided once on the server and held as state, which is wrong the moment the
 * screen lets you edit: an operator could fix the thing the message named and
 * watch the message - and the disabled Create button - stay exactly as they
 * were, with no way forward but starting over.
 */
export function reviewProblems(plans: ImportedPlan[]): string[] {
  const problems: string[] = [];
  if (plans.length === 0) return ["There are no rate plans to create."];

  // A plan the channel told us is priced off another, without saying by how
  // much. Reported before anything else and on its own: until a human supplies
  // the number, it is indistinguishable from a second parent, and complaining
  // about two parents would name a problem the operator does not have.
  const pending = plans.filter((p) => p.needsPercent && derivationOf(p) === null);
  if (pending.length > 0) {
    const base = plans.find((p) => !p.needsPercent && derivationOf(p) === null)?.title ?? "your main rate";
    for (const p of pending) {
      problems.push(
        `"${p.title}": the channel doesn't say how this is priced against "${base}". Enter the percentage - negative if it is cheaper.`
      );
    }
    return problems;
  }

  const parents = plans.filter((p) => derivationOf(p) === null);
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

  // The same validator provisioning uses, so a set that passes here cannot
  // fail for a structural reason at create time.
  problems.push(...validateRatePlanSet(plans));
  return problems;
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
    const amt = asPercent(item?.amountOfStandard);
    // The parent is defined by the ABSENCE of a price difference, which is also
    // how rate-plan-spec decides. A zero difference would be a duplicate of the
    // parent whichever unit it is in.
    //
    // An amount wins when both arrive: a screenshot showing "RON 10 more
    // expensive" has said the amount outright, and any percentage alongside it
    // was inferred rather than read.
    const derivedAmount = isStandard || amt === null || amt === 0 ? null : amt;
    const derivedPercent =
      derivedAmount !== null || isStandard || pct === null || pct === 0 ? null : pct;
    const meal = asString(item?.mealPlan);
    const mealType = meal && /breakfast/i.test(meal) ? "breakfast" : null;

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
      derivedAmount,
      mealType,
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
  const parentIndex = plans.findIndex((p) => derivationOf(p) === null);
  if (parentIndex > 0) plans.unshift(...plans.splice(parentIndex, 1));

  if (!plans.some((p) => p.cancellationPolicy)) {
    // Silence here is fine; noise is not.
  } else {
    warnings.push(
      "Cancellation policies were read from your screenshot but host24 cannot store them yet - they stay as they are on Booking.com."
    );
  }

  // The same checks the review screen re-runs on every edit, so what blocks
  // creation here and what blocks it there can never disagree.
  problems.push(...reviewProblems(plans));

  return { plans, problems, warnings };
}

/**
 * Fill the numbers a channel could not give from a screenshot of the same
 * property's rate plan page.
 *
 * This exists because the two sources are good at opposite things, and neither
 * is good at both. mapping_details gives names, channel ids and the parent
 * relationship exactly - a machine read, incapable of a typo. What it carries
 * no field for is any commercial term: percentage, minimum stay, cancellation
 * policy. A screenshot carries all three and can misread any of them,
 * including the names.
 *
 * So the channel stays authoritative for WHICH plans exist and what they are
 * called, and the screenshot is allowed to supply only the numbers against
 * them. A plan the screenshot shows but the channel does not is NOT added -
 * the channel knows what this property sells, and a misread name inventing a
 * fourth product is exactly the failure this whole design avoids.
 */
export interface MergeResult {
  plans: ImportedPlan[];
  /** Named so the operator can see what the screenshot did and did not answer. */
  filled: string[];
  unmatched: string[];
  stillMissing: string[];
}

/** Titles come from two systems that case and punctuate differently. */
function matchKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function mergeExtractionIntoPlans(
  channelPlans: ImportedPlan[],
  extracted: ImportedPlan[]
): MergeResult {
  const byKey = new Map<string, ImportedPlan>();
  for (const e of extracted) {
    const k = matchKey(e.title);
    // First writer wins: a screenshot listing the same name twice is a read
    // error, and silently taking the second reading would hide it.
    if (!byKey.has(k)) byKey.set(k, e);
  }

  const filled: string[] = [];
  const usedKeys = new Set<string>();
  const stillMissing: string[] = [];

  const plans = channelPlans.map((p) => {
    const match = byKey.get(matchKey(p.title));
    if (!match) {
      if (p.needsPercent && derivationOf(p) === null) stillMissing.push(p.title);
      return p;
    }
    usedKeys.add(matchKey(p.title));

    const next: ImportedPlan = { ...p };
    const gained: string[] = [];

    // Only a plan the channel said is a child may take a percentage. The
    // parent receives its price from the pricing rules and has nothing to
    // derive from, so a screenshot claiming a percentage for it is wrong
    // about which plan is the base - a claim the channel already settled.
    const found = derivationOf(match);
    if (p.needsPercent && derivationOf(p) === null && found !== null) {
      next.derivedPercent = found.kind === "percent" ? found.value : null;
      next.derivedAmount = found.kind === "amount" ? found.value : null;
      next.needsPercent = false;
      gained.push(
        `${found.value > 0 ? "+" : ""}${found.value}${found.kind === "percent" ? "%" : ""}`
      );
    }

    // A minimum stay is taken only when the screenshot genuinely showed one.
    // mapping_details never carries one, so every channel-read plan arrives
    // with a suggestion - and replacing a suggestion with a guess from
    // somewhere else is not an improvement.
    if (!p.minStayWasRead && match.minStayWasRead) {
      next.minStayArrival = match.minStayArrival;
      next.minStayWasRead = true;
      gained.push(`min ${match.minStayArrival} nights`);
    }

    if (!p.cancellationPolicy && match.cancellationPolicy) {
      next.cancellationPolicy = match.cancellationPolicy;
      gained.push(match.cancellationPolicy);
    }

    if (gained.length > 0) filled.push(`${p.title}: ${gained.join(", ")}`);
    // A meal plan is a fact about the product, not a number, so it is taken
    // whenever the screenshot has one and the channel did not.
    if (!p.mealType && match.mealType) {
      next.mealType = match.mealType;
      gained.push(match.mealType);
    }

    if (next.needsPercent && derivationOf(next) === null) stillMissing.push(p.title);
    return next;
  });

  const unmatched = extracted
    .filter((e) => !usedKeys.has(matchKey(e.title)))
    .map((e) => e.title);

  return { plans, filled, unmatched, stillMissing };
}
