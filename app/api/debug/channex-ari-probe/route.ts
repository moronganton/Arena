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

  const apply = new URL(req.url).searchParams.get("apply") === "true";
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

  // If the write looked like it worked, try to confirm by reading the
  // calendar back - path unconfirmed, so this is exploratory too and its
  // failure doesn't invalidate a successful write above.
  const wroteOk = (attempts[0] as { status: string }).status === "ok";
  let readback: unknown = null;
  if (wroteOk) {
    try {
      const res = await channexGet(
        `/availability_calendar?property_id=${listing.channexPropertyId}&room_type_ids[]=${listing.channexRoomTypeId}&date_from=${PROBE_DATE}&date_to=${PROBE_DATE}`
      );
      readback = { status: "ok", response: res.data };
    } catch (err) {
      const e = err as ChannexError;
      readback = { status: "failed", error: { message: e.message, status: e.status, code: e.code, details: e.details } };
    }
  }

  return NextResponse.json({ property: listing.property.name, attempts, readback });
}
