import { prisma } from "@/lib/prisma";
import { channexPost, channexDelete, channexBaseUrl, ChannexError } from "@/lib/channels/channex-core";
import { enqueueAriUpdate, defaultHorizon } from "@/lib/channels/ari-outbox";
import {
  DEFAULT_RATE_PLAN_SET,
  buildDerivedRatePlanPayload,
  buildParentRatePlanPayload,
  isParent,
  validateRatePlanSet,
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
  problems: string[];
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
  };
  if (result.problems.length > 0) return result;

  const parentSpec = specs.find(isParent)!;
  const derivedSpecs = specs.filter((s) => !isParent(s));

  // Dry run: show exactly what would be sent, with the parent id left as a
  // placeholder since it does not exist yet.
  if (!opts.apply) {
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
): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: false, error: e.message };
  }
}
