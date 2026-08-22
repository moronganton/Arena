import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, channexDelete, ChannexError } from "@/lib/channels/channex-core";

// Answers two open questions from the "untapped Channex APIs" review that
// the docs alone couldn't settle (docs.channex.io is blocked from this
// sandbox - see channex-probe/route.ts for why):
//
//   1. Does a `rate_mode: derived` rate plan need its OWN restriction
//      pushes, or does Channex compute its rate from the parent
//      automatically? This decides whether the rate-plan-layer build is a
//      moderate change (push the master only) or a much bigger one (push
//      every plan).
//   2. Is /reviews reachable at all for a StayHQ-connected property, or
//      does it 403 the same way the docs' error section implies it might
//      ("property... not connected to the Messages Application")?
//
// Question 2 is pure GET - runs unconditionally, every time, no ?apply
// needed. Question 1 needs a real rate plan to exist to inspect, so it
// creates ONE throwaway derived plan under the test property's existing
// Standard Rate, reads it back, then deletes it in the same request -
// nothing is left behind either way. Gated behind ?apply=true because
// create+delete are real writes, even though transient ones.
//
//   GET /api/debug/channex-features-probe             -> dry run: reviews
//                                                         check only, shows
//                                                         what the derived-
//                                                         plan step WOULD do
//   GET /api/debug/channex-features-probe?apply=true   -> also creates,
//                                                         reads, and deletes
//                                                         the throwaway
//                                                         derived plan

// A date well inside the horizon the full 500-day sync already pushed real
// seasonal pricing to (see seed-realistic-rates), so the master's
// restrictions readback below has a real, non-default price to compare
// against - not just whatever a fresh unpriced date would show.
function sampleDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 45);
  return d.toISOString().slice(0, 10);
}

function restrictionsPath(p: string, rt: string, rp: string, date: string): string {
  return (
    `/restrictions?filter%5Bproperty_id%5D=${p}&filter%5Broom_type_id%5D=${rt}` +
    `&filter%5Brate_plan_id%5D=${rp}&filter%5Bdate%5D=${date}` +
    `&filter%5Brestrictions%5D%5B%5D=rate&filter%5Brestrictions%5D%5B%5D=min_stay_arrival` +
    `&filter%5Brestrictions%5D%5B%5D=stop_sell`
  );
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const listing = await prisma.channexListing.findFirst({
    where: { property: { ownerId: userId } },
    include: { property: { select: { id: true, name: true, currency: true, maxGuests: true } } },
  });
  if (!listing) {
    return NextResponse.json({ error: "No ChannexListing found - run /api/channex/provision first" }, { status: 404 });
  }

  const apply = new URL(req.url).searchParams.get("apply") === "true";
  const date = sampleDate();

  // ---- Question 2: is /reviews reachable? Pure GET, always runs. ----
  const reviewsAttempts: unknown[] = [];
  for (const path of [
    "/reviews",
    `/reviews?filter%5Bproperty_id%5D=${listing.channexPropertyId}`,
  ]) {
    try {
      const res = await channexGet(path);
      reviewsAttempts.push({ path, status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      reviewsAttempts.push({
        path,
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }
  const reviewsReachable = reviewsAttempts.some((a) => (a as { status: string }).status === "ok");

  // ---- Question 1: does a derived plan carry its own restrictions? ----
  // Two candidate payloads, tried in order - the second only if the first
  // is rejected. Neither guesses a discount field, deliberately: whatever
  // Channex's 422 says is missing is more reliable than a guessed field
  // name, the same "let the error tell us" approach that found the real
  // ARI payload shape in channex-ari-probe.
  const derivedPayloadMinimal = {
    rate_plan: {
      property_id: listing.channexPropertyId,
      room_type_id: listing.channexRoomTypeId,
      parent_rate_plan_id: listing.channexRatePlanId,
      title: "[probe] derived rate plan test - safe to ignore if seen on Channex",
      currency: listing.property.currency,
      sell_mode: "per_room",
      rate_mode: "derived",
    },
  };
  const derivedPayloadWithOptions = {
    rate_plan: {
      ...derivedPayloadMinimal.rate_plan,
      options: [{ occupancy: listing.property.maxGuests, is_primary: true }],
    },
  };

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - the derived-plan step below was NOT run. /reviews above already ran (pure GET).",
      property: listing.property.name,
      sampleDate: date,
      reviewsReachable,
      reviewsAttempts,
      wouldCreate: {
        firstTry: derivedPayloadMinimal,
        fallbackIfRejected: derivedPayloadWithOptions,
      },
      nextStep: "Add ?apply=true to actually create, inspect, and delete the throwaway derived plan.",
    });
  }

  const steps: Array<Record<string, unknown>> = [];

  // Step A: what the MASTER (Standard Rate) already reports for this date -
  // ground truth from real pushed data, not a probe artifact.
  try {
    const res = await channexGet(
      restrictionsPath(listing.channexPropertyId, listing.channexRoomTypeId, listing.channexRatePlanId, date)
    );
    steps.push({ step: "A. master restrictions readback", status: "ok", response: res.data });
  } catch (err) {
    const e = err as ChannexError;
    steps.push({
      step: "A. master restrictions readback",
      status: "failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
  }

  // Step B: create the throwaway derived plan.
  let derivedId: string | null = null;
  let createdWith: "minimal" | "withOptions" | null = null;
  try {
    const res = await channexPost<{ id: string }>("/rate_plans", derivedPayloadMinimal);
    derivedId = res.data.id;
    createdWith = "minimal";
    steps.push({ step: "B. create derived plan (minimal payload)", status: "ok", payload: derivedPayloadMinimal, response: res.data });
  } catch (err) {
    const e = err as ChannexError;
    steps.push({
      step: "B. create derived plan (minimal payload)",
      status: "failed",
      payload: derivedPayloadMinimal,
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
    try {
      const res2 = await channexPost<{ id: string }>("/rate_plans", derivedPayloadWithOptions);
      derivedId = res2.data.id;
      createdWith = "withOptions";
      steps.push({ step: "B2. create derived plan (with options fallback)", status: "ok", payload: derivedPayloadWithOptions, response: res2.data });
    } catch (err2) {
      const e2 = err2 as ChannexError;
      steps.push({
        step: "B2. create derived plan (with options fallback)",
        status: "failed",
        payload: derivedPayloadWithOptions,
        error: { message: e2.message, status: e2.status, code: e2.code, details: e2.details },
      });
    }
  }

  // Step C + D: only reachable if B succeeded - what does the derived plan
  // itself report, both as an object and via the same restrictions readback
  // used for the master, WITHOUT ever pushing anything to it.
  if (derivedId) {
    try {
      const res = await channexGet(`/rate_plans/${derivedId}`);
      steps.push({ step: "C. GET the derived plan object", status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      steps.push({ step: "C. GET the derived plan object", status: "failed", error: { message: e.message, status: e.status, code: e.code, details: e.details } });
    }

    try {
      const res = await channexGet(
        restrictionsPath(listing.channexPropertyId, listing.channexRoomTypeId, derivedId, date)
      );
      steps.push({ step: "D. derived plan restrictions readback (nothing pushed to it)", status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      steps.push({
        step: "D. derived plan restrictions readback (nothing pushed to it)",
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }

    // Step E: cleanup - always attempted if creation succeeded, so nothing
    // real is left behind regardless of what steps C/D found.
    try {
      await channexDelete(`/rate_plans/${derivedId}`);
      steps.push({ step: "E. delete the throwaway derived plan", status: "ok" });
    } catch (err) {
      const e = err as ChannexError;
      steps.push({
        step: "E. delete the throwaway derived plan",
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
        warning: "Cleanup failed - a [probe] rate plan may still exist on Channex. Safe to delete manually from the dashboard.",
      });
    }
  }

  return NextResponse.json({
    property: listing.property.name,
    sampleDate: date,
    createdWith,
    reviewsReachable,
    reviewsAttempts,
    steps,
    verdict: {
      reviews: reviewsReachable
        ? "Reviews IS reachable on this property with no extra setup - the Reviews feature is buildable as scoped."
        : "Reviews was NOT reachable as probed - check the 403/404 detail above; may need an app installed first.",
      derivedPlan: derivedId
        ? "See step D: if it reports the same rate as step A's master readback, Channex computes derived plans automatically (push the master only). If it's empty/default, derived plans need their own restriction pushes."
        : "Could not create a derived plan with either payload - see step B/B2 errors for what Channex actually requires.",
    },
  });
}
