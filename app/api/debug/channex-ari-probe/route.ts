import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channexPost, channexGet, ChannexError } from "@/lib/channels/channex-core";

// Discovers Channex's real ARI (availability/rate/restriction) update
// endpoint, against Sinteu's already-provisioned sandbox listing.
//
// The candidate payload isn't a blind guess: Sinteu's rate plan (created in
// step 4) came back with weekly-pattern fields named stop_sell,
// min_stay_arrival, min_stay_through, max_stay, closed_to_arrival,
// closed_to_departure - the same names a date-specific restrictions endpoint
// would very likely reuse. This tests that theory against the real API, the
// same probe-and-correct loop that found the country-code and auth-header
// requirements in steps 3 and 4.
//
// Uses a date far in 2027, deliberately outside every real test booking on
// Sinteu, so a write here can't collide with anything that matters.
//
//   GET /api/debug/channex-ari-probe                 -> dry run, shows the payload only
//   GET /api/debug/channex-ari-probe?apply=true       -> sends it, reports Channex's real response
const PROBE_DATE = "2027-06-15";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const listing = await prisma.channexListing.findFirst({
    where: { property: { ownerId: session.user.id } },
    include: { property: { select: { name: true } } },
  });
  if (!listing) {
    return NextResponse.json({ error: "No ChannexListing found - run /api/channex/provision first" }, { status: 404 });
  }

  const candidatePayload = {
    values: [
      {
        property_id: listing.channexPropertyId,
        room_type_id: listing.channexRoomTypeId,
        rate_plan_id: listing.channexRatePlanId,
        date: PROBE_DATE,
        availability: 0,
      },
    ],
  };

  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "true";
  // The write is already confirmed working (POST /restrictions returns a
  // task). Skip re-sending it while iterating on the readback shape alone,
  // so retries don't pile up redundant tasks on Channex's side.
  const skipWrite = url.searchParams.get("skipWrite") === "true";
  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      property: listing.property.name,
      candidateEndpoint: "POST /restrictions",
      candidatePayload,
      nextStep: "Add ?apply=true to actually send this and see Channex's real response.",
    });
  }

  const attempts: unknown[] = [];

  if (skipWrite) {
    attempts.push({ endpoint: "POST /restrictions", status: "skipped", note: "skipWrite=true - assuming an earlier apply already wrote this date" });
  } else {
    try {
      const res = await channexPost("/restrictions", candidatePayload);
      attempts.push({ endpoint: "POST /restrictions", payload: candidatePayload, status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      attempts.push({
        endpoint: "POST /restrictions",
        payload: candidatePayload,
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  // Availability write+readback is now confirmed working end to end. The
  // FIRST rate test (rate: 55) came back on readback as "rate":"0.55" - a
  // 100x scale-down, not a rounding artefact. That is exactly the shape of
  // a minor-units convention (cents, like Stripe): 55 read as 55 minor
  // units = EUR 0.55. This second test sends 5500 on a fresh date; if the
  // theory is right, readback should show "55.00" - confirmed BEFORE
  // building any real push logic, since getting this wrong would silently
  // push every price at 1/100th of its real value.
  const RATE_PROBE_DATE = "2027-06-17";
  const ratePayload = {
    values: [
      {
        property_id: listing.channexPropertyId,
        room_type_id: listing.channexRoomTypeId,
        rate_plan_id: listing.channexRatePlanId,
        date: RATE_PROBE_DATE,
        rate: 5500,
      },
    ],
  };
  if (!skipWrite) {
    try {
      const res = await channexPost("/restrictions", ratePayload);
      attempts.push({ endpoint: "POST /restrictions (rate=5500, testing minor-units theory)", payload: ratePayload, status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      attempts.push({
        endpoint: "POST /restrictions (rate=5500, testing minor-units theory)",
        payload: ratePayload,
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  const first = attempts[0] as { status: string; response?: unknown };
  const wroteOk = skipWrite || first.status === "ok";

  // The write returned { id, type: "task" } rather than applying inline -
  // Channex processes restriction updates asynchronously. Check the task's
  // own status before trying to read the calendar back, since a still-
  // pending task would make a calendar read look like a false failure.
  let taskStatus: unknown = null;
  if (wroteOk) {
    const taskId = (first.response as Array<{ id?: string }> | undefined)?.[0]?.id;
    if (taskId) {
      for (const path of [`/tasks/${taskId}`, `/restrictions/tasks/${taskId}`]) {
        try {
          const res = await channexGet(path);
          taskStatus = { path, status: "ok", response: res.data };
          break;
        } catch (err) {
          const e = err as ChannexError;
          taskStatus = { path, status: "failed", error: { message: e.message, status: e.status, code: e.code } };
        }
      }
    }
  }

  // Availability readback CONFIRMED working:
  //   GET /availability?filter[property_id]=&filter[room_type_id]=&filter[date]=
  //   -> { [room_type_id]: { [date]: availabilityValue } }
  // Kept as the first candidate below (now a confirmation re-check rather
  // than exploration), alongside new candidates for the rate write and for
  // /restrictions, which separately demanded "restrictions is required" -
  // apparently needs filter[restrictions][]=<field name> to say which
  // restriction fields to return.
  let readback: unknown = null;
  if (wroteOk) {
    const p = listing.channexPropertyId;
    const rt = listing.channexRoomTypeId;
    const rp = listing.channexRatePlanId;
    const candidates = [
      `/availability?filter%5Bproperty_id%5D=${p}&filter%5Broom_type_id%5D=${rt}&filter%5Bdate%5D=${PROBE_DATE}`,
      `/availability?filter%5Bproperty_id%5D=${p}&filter%5Broom_type_id%5D=${rt}&filter%5Bdate%5D=${RATE_PROBE_DATE}`,
      `/restrictions?filter%5Bproperty_id%5D=${p}&filter%5Broom_type_id%5D=${rt}&filter%5Brate_plan_id%5D=${rp}&filter%5Bdate%5D=${RATE_PROBE_DATE}&filter%5Brestrictions%5D%5B%5D=rate`,
      `/restrictions?filter%5Bproperty_id%5D=${p}&filter%5Broom_type_id%5D=${rt}&filter%5Brate_plan_id%5D=${rp}&filter%5Bdate%5D=${RATE_PROBE_DATE}&filter%5Brestrictions%5D%5B%5D=rate&filter%5Brestrictions%5D%5B%5D=min_stay_arrival&filter%5Brestrictions%5D%5B%5D=stop_sell`,
    ];
    const tried: unknown[] = [];
    for (const path of candidates) {
      try {
        const res = await channexGet(path);
        tried.push({ path, status: "ok", response: res.data });
      } catch (err) {
        const e = err as ChannexError;
        tried.push({ path, status: "failed", error: { message: e.message, status: e.status, code: e.code, details: e.details } });
      }
    }
    readback = tried;
  }

  return NextResponse.json({ property: listing.property.name, attempts, taskStatus, readback });
}
