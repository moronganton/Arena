import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { provisionRatePlanSet, deleteRatePlan, addDerivedRatePlan } from "@/lib/channels/channex-rate-plans";
import { DEFAULT_RATE_PLAN_SET } from "@/lib/channels/rate-plan-spec";

// Provisioning a rate plan family for ONE property.
//
// Scoped by propertyId and gated by requireChannexProperty, which is what makes
// this structurally incapable of touching a Smoobu property: it checks
// ownership, that channelProvider is CHANNEX, and that a ChannexListing exists.
// A property still on Smoobu fails all three, and the Channex endpoints below
// are addressed by a channex_property_id that such a property does not have.
//
// Dry run by default, matching /api/channex/provision. These are writes to a
// live property that real guests book, so `apply: true` has to be asked for.
//
//   GET  /api/channex/rate-plans?propertyId=...        - what exists now
//   POST /api/channex/rate-plans                       - dry run
//   POST /api/channex/rate-plans  { apply: true }      - create the family
//   POST /api/channex/rate-plans  { deleteRatePlanId } - remove the old plan

const provisionSchema = z.object({
  propertyId: z.string().min(1),
  apply: z.boolean().default(false),
  // Rename a colliding plan being replaced out of the way first.
  retireExisting: z.boolean().default(false),
  // Removing a plan the family replaced. Refused if it is the one currently
  // being pushed into - see deleteRatePlan.
  deleteRatePlanId: z.string().min(1).optional(),
  // Adding ONE derived plan to a family that already exists, as opposed to
  // provisioning a whole set.
  addPlan: z
    .object({
      title: z.string().min(1),
      derivedPercent: z.number(),
      minStayArrival: z.number().int().min(1),
    })
    .optional(),
  // The family to create, when it is not the default one - what the operator
  // approved on the import review screen. provisionRatePlanSet already takes
  // `specs`; the route simply never offered it, so every property got the
  // template whether or not it matched what they actually sell.
  specs: z
    .array(
      z.object({
        title: z.string().min(1),
        derivedPercent: z.number().nullable(),
        minStayArrival: z.number().int().min(1),
      })
    )
    .min(1)
    .optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const ratePlans = await prisma.ratePlan.findMany({
    where: { channexListingId: guard.channexListingId },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({
    property: guard.propertyName,
    pushesInto: guard.channexRatePlanId,
    ratePlans,
    defaultSetIfNotProvisioned: ratePlans.length === 0 ? DEFAULT_RATE_PLAN_SET : undefined,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = provisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { propertyId, apply, retireExisting, deleteRatePlanId, addPlan, specs } = parsed.data;

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (deleteRatePlanId) {
    const res = await deleteRatePlan(guard.channexListingId, deleteRatePlanId);
    return NextResponse.json(
      { property: guard.propertyName, deleted: res.ok ? deleteRatePlanId : null, error: res.error, details: res.details },
      { status: res.ok ? 200 : 409 }
    );
  }

  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { currency: true, maxGuests: true },
  });

  if (addPlan) {
    const res = await addDerivedRatePlan({
      channexListingId: guard.channexListingId,
      channexPropertyId: guard.channexPropertyId,
      channexRoomTypeId: guard.channexRoomTypeId,
      currency: property.currency,
      occupancy: property.maxGuests,
      spec: { ...addPlan, derivedPercent: addPlan.derivedPercent },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error, problems: res.problems, details: res.details },
        { status: res.problems ? 400 : 409 }
      );
    }
    return NextResponse.json({ ok: true, channexRatePlanId: res.channexRatePlanId });
  }

  const result = await provisionRatePlanSet({
    channexListingId: guard.channexListingId,
    propertyId,
    propertyName: guard.propertyName,
    channexPropertyId: guard.channexPropertyId,
    channexRoomTypeId: guard.channexRoomTypeId,
    currency: property.currency,
    occupancy: property.maxGuests,
    currentChannexRatePlanId: guard.channexRatePlanId,
    apply,
    retireExisting,
    // Undefined falls through to DEFAULT_RATE_PLAN_SET, so the template path
    // is unchanged.
    specs,
  });

  if (result.problems.length > 0) {
    return NextResponse.json({ status: "rejected", problems: result.problems }, { status: 400 });
  }

  const status = result.applied
    ? "created"
    : apply
      ? "FAILED - see steps"
      : "dry run - nothing was created on Channex";

  // A requested apply that did not apply is a FAILURE, and must not leave with
  // a 2xx. It used to: callers saw res.ok, reported success, re-read, found no
  // plans, and bounced the operator back to the start of setup with no error
  // anywhere - the failing step was in a body nobody was reading.
  const failedApply = apply && !result.applied;
  const firstFailure = result.steps.find((s) => s.status === "failed");

  return NextResponse.json({
    status,
    ...(failedApply
      ? {
          error:
            firstFailure?.error?.message ??
            "Channex rejected these rate plans - see steps for the exact response.",
        }
      : {}),
    ...result,
    nextStep: result.applied
      ? `Confirm prices land on ${result.parentChannexRatePlanId} after the next drain-ari cycle, then POST { deleteRatePlanId: "${result.previousParentChannexRatePlanId}" } to remove the old plan.`
      : "Send apply: true to create these on Channex.",
  }, { status: failedApply ? 502 : 200 });
}
