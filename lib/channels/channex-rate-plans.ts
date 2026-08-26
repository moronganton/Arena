import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, channexPut, channexDelete, channexBaseUrl, ChannexError } from "@/lib/channels/channex-core";
import { enqueueAriUpdate, defaultHorizon } from "@/lib/channels/ari-outbox";
import {
  DEFAULT_RATE_PLAN_SET,
  buildDerivedRatePlanPayload,
  buildParentRatePlanPayload,
  buildRatePlanUpdatePayload,
  findTitleCollisions,
  isParent,
  retiredTitle,
  validateRatePlanChanges,
  validateRatePlanSet,
  type RatePlanChanges,
  type RatePlanPayloadContext,
  type RatePlanSpec,
} from "@/lib/channels/rate-plan-spec";

// Creates a rate plan family on Channex and records it locally.
//
// The order here is the whole safety story, and it is deliberately
// create-then-cutover rather than delete-then-create:
//
//   1. create the new parent          - the old plan is still live and selling
//   2. create each derived child       - still nothing pointing at them
//   3. point the listing at the parent - StayHQ now pushes into the new family
//   4. queue a full ARI push           - the new parent gets real prices
//   5. delete the old plan             - SEPARATE call, only once 1-4 are proven
//
// Reversed, there is a window where the listing has no sellable rate at all and
// every channel sees the property as unavailable. Step 5 is not part of this
// function for the same reason: an automatic delete would fire on the same run
// that created the replacement, before anyone has confirmed the replacement
// works.

const MS_BETWEEN_CREATES = 400; // polite pacing; these are content writes, not ARI

export interface RatePlanStep {
  step: string;
  path: string;
  payload: unknown;
  status: "planned" | "ok" | "failed";
  response?: unknown;
  error?: { message: string; status?: number; code?: string; details?: unknown };
}

export interface ProvisionRatePlansResult {
  applied: boolean;
  /**
   * Which Channex these plans are created on. Surfaced because the base URL
   * DEFAULTS to staging - an unset CHANNEX_BASE_URL in a production
   * environment writes to staging silently, and the reverse mistake creates
   * live plans on a real property while you believe you are testing. Neither
   * shows up in the response body otherwise.
   */
  channexHost: string;
  propertyName: string;
  parentChannexRatePlanId: string | null;
  previousParentChannexRatePlanId: string;
  created: { title: string; channexRatePlanId: string; derivedPercent: number | null; minStayArrival: number }[];
  steps: RatePlanStep[];
  /** Blockers. A non-empty list means nothing was attempted. */
  problems: string[];
  /**
   * Things a dry run wants to say without refusing to show its plan. A
   * collision is a blocker on apply and a warning on a preview - reporting it
   * as a blocker would return an error instead of the very plan you asked to
   * see.
   */
  warnings: string[];
}

export interface ProvisionRatePlansOptions {
  channexListingId: string;
  propertyId: string;
  propertyName: string;
  channexPropertyId: string;
  channexRoomTypeId: string;
  currency: string;
  occupancy: number;
  /** Existing parent, so the caller can see what is being replaced. */
  currentChannexRatePlanId: string;
  specs?: RatePlanSpec[];
  /** Nothing is written to Channex or the database unless this is true. */
  apply: boolean;
  /**
   * Rename the plan being replaced so its title stops colliding with the
   * family taking over. Off by default: renaming a plan that is currently
   * selling is a real change to a live listing, and it should be asked for.
   */
  retireExisting?: boolean;
}

interface ChannexRatePlanRow {
  id: string;
  attributes?: { title?: string };
  relationships?: { property?: { data?: { id?: string } } };
}

// Titles already on this property. Read rather than assumed, because the
// collision this prevents is raised by Channex at create time and would
// otherwise be discovered halfway through building a family.
async function fetchExistingTitles(
  channexPropertyId: string
): Promise<{ titles: string[]; byTitle: Map<string, string> }> {
  const res = await channexGet<ChannexRatePlanRow[]>("/rate_plans");
  const rows = (res.data ?? []).filter(
    (r) => r.relationships?.property?.data?.id === channexPropertyId
  );
  const byTitle = new Map<string, string>();
  for (const r of rows) {
    const t = r.attributes?.title;
    if (t) byTitle.set(t.trim().toLowerCase(), r.id);
  }
  return { titles: [...byTitle.keys()], byTitle };
}

export async function provisionRatePlanSet(
  opts: ProvisionRatePlansOptions
): Promise<ProvisionRatePlansResult> {
  const specs = opts.specs ?? DEFAULT_RATE_PLAN_SET;
  const ctx: RatePlanPayloadContext = {
    channexPropertyId: opts.channexPropertyId,
    channexRoomTypeId: opts.channexRoomTypeId,
    currency: opts.currency,
    occupancy: opts.occupancy,
  };

  const result: ProvisionRatePlansResult = {
    applied: false,
    channexHost: channexBaseUrl(),
    propertyName: opts.propertyName,
    parentChannexRatePlanId: null,
    previousParentChannexRatePlanId: opts.currentChannexRatePlanId,
    created: [],
    steps: [],
    problems: validateRatePlanSet(specs),
    warnings: [],
  };
  if (result.problems.length > 0) return result;

  const parentSpec = specs.find(isParent)!;
  const derivedSpecs = specs.filter((s) => !isParent(s));

  // --- 0. title collisions ---
  // Channex raises "Duplication in Rate Plan title is not allowed!" as a 422 at
  // create time. Checked before anything is written, because a collision hit on
  // the third child leaves a half-built family behind, where one found here
  // leaves nothing at all.
  //
  // Deliberately ahead of the dry-run branch. An earlier version checked only
  // on apply, so a dry run reported a clean plan and the apply that followed
  // failed on the first call - which is the opposite of what a dry run is for.
  // It costs one GET to tell the truth instead.
  const existing = await fetchExistingTitles(opts.channexPropertyId);
  const collisions = findTitleCollisions(specs, existing.titles);
  const retireSteps: RatePlanStep[] = collisions.map((title) => {
    const id = existing.byTitle.get(title.trim().toLowerCase()) ?? "(unknown)";
    return {
      step: `retire existing "${title}" -> "${retiredTitle(title, id)}"`,
      path: `/rate_plans/${id}`,
      payload: { rate_plan: { title: retiredTitle(title, id) } },
      status: "planned" as const,
    };
  });

  // Dry run: show exactly what would be sent, with the parent id left as a
  // placeholder since it does not exist yet.
  if (!opts.apply) {
    if (collisions.length > 0) {
      result.warnings.push(
        `these titles already exist on the property: ${collisions.join(", ")}. ` +
          `Channex does not allow duplicates, so applying as-is would fail on the first call. ` +
          `Pass retireExisting to rename the plan being replaced out of the way first.`
      );
      result.steps.push(...retireSteps);
    }
    result.steps.push({
      step: `create parent "${parentSpec.title}"`,
      path: "/rate_plans",
      payload: buildParentRatePlanPayload(parentSpec, ctx),
      status: "planned",
    });
    for (const spec of derivedSpecs) {
      result.steps.push({
        step: `create derived "${spec.title}" (${spec.derivedPercent}% , min stay ${spec.minStayArrival})`,
        path: "/rate_plans",
        payload: buildDerivedRatePlanPayload(spec, "<parent id from step 1>", ctx),
        status: "planned",
      });
    }
    return result;
  }

  if (collisions.length > 0 && !opts.retireExisting) {
    result.problems.push(
      `these titles already exist on the property: ${collisions.join(", ")}. ` +
        `Channex does not allow duplicates. Pass retireExisting to rename the plan being ` +
        `replaced out of the way first, or choose different titles.`
    );
    return result;
  }

  if (collisions.length > 0) {
    for (const title of collisions) {
      const id = existing.byTitle.get(title.trim().toLowerCase());
      if (!id) continue;
      // Only ever rename the plan this run is replacing. Renaming some other
      // colliding plan would be silently editing something nobody asked about.
      if (id !== opts.currentChannexRatePlanId) {
        result.problems.push(
          `"${title}" collides with rate plan ${id}, which is not the one being replaced ` +
            `(${opts.currentChannexRatePlanId}). Refusing to rename a plan this run does not own.`
        );
        return result;
      }
      const newTitle = retiredTitle(title, id);
      const payload = { rate_plan: { title: newTitle } };
      try {
        await channexPut(`/rate_plans/${id}`, payload);
        result.steps.push({
          step: `retire existing "${title}" -> "${newTitle}"`,
          path: `/rate_plans/${id}`, payload, status: "ok",
        });
      } catch (err) {
        const e = err as ChannexError;
        result.steps.push({
          step: `retire existing "${title}"`, path: `/rate_plans/${id}`, payload, status: "failed",
          error: { message: e.message, status: e.status, code: e.code, details: e.details },
        });
        // Still nothing created - the old plan keeps its name and keeps selling.
        return result;
      }
    }
  }

  // --- 1. parent ---
  const parentPayload = buildParentRatePlanPayload(parentSpec, ctx);
  let parentId: string;
  try {
    const created = await channexPost<{ id: string }>("/rate_plans", parentPayload);
    parentId = created.data.id;
    result.steps.push({
      step: `create parent "${parentSpec.title}"`, path: "/rate_plans",
      payload: parentPayload, status: "ok", response: created.data,
    });
  } catch (err) {
    const e = err as ChannexError;
    result.steps.push({
      step: `create parent "${parentSpec.title}"`, path: "/rate_plans", payload: parentPayload, status: "failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
    // Nothing has changed anywhere - the old plan is still the listing's parent
    // and is still selling.
    return result;
  }
  result.parentChannexRatePlanId = parentId;
  result.created.push({
    title: parentSpec.title, channexRatePlanId: parentId,
    derivedPercent: null, minStayArrival: parentSpec.minStayArrival,
  });

  // --- 2. derived children ---
  for (const spec of derivedSpecs) {
    await new Promise((r) => setTimeout(r, MS_BETWEEN_CREATES));
    const payload = buildDerivedRatePlanPayload(spec, parentId, ctx);
    try {
      const created = await channexPost<{ id: string }>("/rate_plans", payload);
      result.steps.push({
        step: `create derived "${spec.title}"`, path: "/rate_plans",
        payload, status: "ok", response: created.data,
      });
      result.created.push({
        title: spec.title, channexRatePlanId: created.data.id,
        derivedPercent: spec.derivedPercent, minStayArrival: spec.minStayArrival,
      });
    } catch (err) {
      const e = err as ChannexError;
      result.steps.push({
        step: `create derived "${spec.title}"`, path: "/rate_plans", payload, status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
      // Deliberately keep going. A family missing one child is a worse product
      // but a working one; abandoning here would leave the parent orphaned and
      // the listing still on the old plan, which is harder to reason about than
      // "five of six created, here is the one that failed".
    }
  }

  // --- 3. record locally and cut the listing over ---
  await prisma.$transaction(async (tx) => {
    await tx.ratePlan.deleteMany({ where: { channexListingId: opts.channexListingId } });
    await tx.ratePlan.createMany({
      data: result.created.map((c, i) => ({
        channexListingId: opts.channexListingId,
        channexRatePlanId: c.channexRatePlanId,
        title: c.title,
        kind: c.derivedPercent === null ? "PARENT" : "DERIVED",
        derivedPercent: c.derivedPercent,
        minStayArrival: c.minStayArrival,
        position: i,
      })),
    });
    await tx.channexListing.update({
      where: { id: opts.channexListingId },
      data: { channexRatePlanId: parentId },
    });
  });
  result.steps.push({
    step: "point listing at the new parent",
    path: "(database)",
    payload: { channexRatePlanId: parentId, was: opts.currentChannexRatePlanId },
    status: "ok",
  });

  // --- 4. get real prices onto the new parent ---
  // The parent was created with rate 0. Until a push lands it is a live plan
  // priced at nothing, so this is queued immediately rather than left to the
  // next incidental edit. Children need no push of their own - Channex derives
  // them the moment the parent moves.
  const { from, to } = defaultHorizon();
  await enqueueAriUpdate(opts.propertyId, from, to, "RATE");
  await enqueueAriUpdate(opts.propertyId, from, to, "RESTRICTION");
  result.steps.push({
    step: "queue full ARI push onto the new parent",
    path: "(AriOutbox)",
    payload: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    status: "ok",
  });

  result.applied = true;
  return result;
}

// Removing the plan the family replaced. Separate on purpose - see the note at
// the top of this file - and refuses to remove a plan the listing is currently
// pushing into, which would leave the property with no sellable rate.
export async function deleteRatePlan(
  channexListingId: string,
  channexRatePlanId: string
): Promise<{ ok: boolean; error?: string; details?: unknown }> {
  const listing = await prisma.channexListing.findUnique({
    where: { id: channexListingId },
    select: { channexRatePlanId: true },
  });
  if (!listing) return { ok: false, error: "listing not found" };
  if (listing.channexRatePlanId === channexRatePlanId) {
    return { ok: false, error: "refusing to delete the plan this listing currently pushes into" };
  }
  try {
    await channexDelete(`/rate_plans/${channexRatePlanId}`);
    await prisma.ratePlan.deleteMany({ where: { channexListingId, channexRatePlanId } });
    return { ok: true };
  } catch (err) {
    const e = err as ChannexError;
    // Already gone is the outcome we wanted.
    if (e.status === 404) {
      await prisma.ratePlan.deleteMany({ where: { channexListingId, channexRatePlanId } });
      return { ok: true };
    }
    // e.message alone is "Validation Error (validation_error)", which says
    // nothing. Channex puts the actual reason in details - a rate plan with
    // bookings against it, or one still mapped to a channel, cannot be
    // removed, and knowing which changes what you do next.
    return { ok: false, error: e.message, details: e.details };
  }
}

// Changing one plan in an existing family.
//
// Channex first, database second. If Channex rejects the change, the local row
// still describes what is really out there - the reverse order would leave the
// app confidently showing a percentage the OTAs have never heard of.
export async function updateRatePlan(
  channexListingId: string,
  ratePlanId: string,
  changes: RatePlanChanges,
  occupancy: number
): Promise<{ ok: boolean; error?: string; details?: unknown; problems?: string[] }> {
  const plan = await prisma.ratePlan.findFirst({ where: { id: ratePlanId, channexListingId } });
  if (!plan) return { ok: false, error: "rate plan not found on this listing" };
  if (!plan.channexRatePlanId) return { ok: false, error: "this plan has never been provisioned on Channex" };

  const siblings = await prisma.ratePlan.findMany({
    where: { channexListingId, id: { not: ratePlanId } },
    select: { title: true },
  });
  const problems = validateRatePlanChanges(changes, plan.kind === "PARENT", siblings.map((s) => s.title));
  if (problems.length > 0) return { ok: false, problems };

  const payload = buildRatePlanUpdatePayload(changes, occupancy);
  if (Object.keys(payload.rate_plan).length === 0) return { ok: false, error: "nothing to change" };

  try {
    await channexPut(`/rate_plans/${plan.channexRatePlanId}`, payload);
  } catch (err) {
    const e = err as ChannexError;
    return { ok: false, error: e.message, details: e.details };
  }

  await prisma.ratePlan.update({
    where: { id: ratePlanId },
    data: {
      ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
      ...(changes.derivedPercent !== undefined ? { derivedPercent: changes.derivedPercent } : {}),
      ...(changes.minStayArrival !== undefined ? { minStayArrival: changes.minStayArrival } : {}),
    },
  });
  return { ok: true };
}

// Adding one derived plan to a family that already exists.
//
// Always derived, never a second parent: a listing has exactly one plan that
// receives prices, and a second would silently receive nothing.
export async function addDerivedRatePlan(
  opts: {
    channexListingId: string;
    channexPropertyId: string;
    channexRoomTypeId: string;
    currency: string;
    occupancy: number;
    spec: RatePlanSpec;
  }
): Promise<{ ok: boolean; channexRatePlanId?: string; error?: string; details?: unknown; problems?: string[] }> {
  if (opts.spec.derivedPercent === null) {
    return { ok: false, problems: ["a new plan must have a percentage - there can only be one parent"] };
  }

  const existing = await prisma.ratePlan.findMany({ where: { channexListingId: opts.channexListingId } });
  const parent = existing.find((p) => p.kind === "PARENT");
  if (!parent?.channexRatePlanId) {
    return { ok: false, error: "this listing has no provisioned parent plan to derive from" };
  }

  const problems = validateRatePlanChanges(
    { title: opts.spec.title, derivedPercent: opts.spec.derivedPercent, minStayArrival: opts.spec.minStayArrival },
    false,
    existing.map((p) => p.title)
  );
  if (problems.length > 0) return { ok: false, problems };

  const payload = buildDerivedRatePlanPayload(opts.spec, parent.channexRatePlanId, {
    channexPropertyId: opts.channexPropertyId,
    channexRoomTypeId: opts.channexRoomTypeId,
    currency: opts.currency,
    occupancy: opts.occupancy,
  });

  let created: { id: string };
  try {
    created = (await channexPost<{ id: string }>("/rate_plans", payload)).data;
  } catch (err) {
    const e = err as ChannexError;
    return { ok: false, error: e.message, details: e.details };
  }

  await prisma.ratePlan.create({
    data: {
      channexListingId: opts.channexListingId,
      channexRatePlanId: created.id,
      title: opts.spec.title.trim(),
      kind: "DERIVED",
      derivedPercent: opts.spec.derivedPercent,
      minStayArrival: opts.spec.minStayArrival,
      position: existing.length,
    },
  });
  return { ok: true, channexRatePlanId: created.id };
}

// Removing a plan from a family, by its local id.
//
// deleteRatePlan above takes a Channex id and exists for retiring a REPLACED
// plan - one this app may never have had a row for. This is the one a UI calls,
// and it refuses to remove the parent: every other plan derives from it, so
// deleting it would leave five products quoting nothing.
export async function removeRatePlan(
  channexListingId: string,
  ratePlanId: string
): Promise<{ ok: boolean; error?: string; details?: unknown }> {
  const plan = await prisma.ratePlan.findFirst({ where: { id: ratePlanId, channexListingId } });
  if (!plan) return { ok: false, error: "rate plan not found on this listing" };
  if (plan.kind === "PARENT") {
    return { ok: false, error: "the parent cannot be removed - every other plan derives from it" };
  }
  if (!plan.channexRatePlanId) {
    await prisma.ratePlan.delete({ where: { id: ratePlanId } });
    return { ok: true };
  }
  const res = await deleteRatePlan(channexListingId, plan.channexRatePlanId);
  if (res.ok) await prisma.ratePlan.deleteMany({ where: { id: ratePlanId } });
  return res;
}
