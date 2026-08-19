import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, channexConfigured, ChannexError } from "@/lib/channels/channex-core";

// Provisions a StayHQ property onto Channex: property -> room type -> rate
// plan, storing the resulting triple in ChannexListing.
//
// Channex models one bookable unit as three nested objects, so a single
// StayHQ property maps to a chain of three Channex records rather than one.
// Proving that mapping against the real API - instead of assuming it - is
// the point of this step.
//
//   GET /api/channex/provision                          -> lists candidate properties
//   GET /api/channex/provision?propertyId=<id>          -> DRY RUN, shows payloads only
//   GET /api/channex/provision?propertyId=<id>&apply=true -> creates on Channex
//
// Deliberately targets whichever property is named, so a throwaway test
// property can be used first. Re-running after success writes nothing: the
// ChannexListing row short-circuits it.
//
// Every step reports the exact payload sent and the response received. The
// sandbox can't reach channex.io to confirm required fields ahead of time,
// so a 422 here is expected to be informative rather than fatal.

// Only the countries actually in use need to be here - anything else fails
// with a clear message and a ?countryCode= override instead of guessing.
const COUNTRY_TO_ISO2: Record<string, string> = {
  Romania: "RO",
  "Czech Republic": "CZ",
  Czechia: "CZ",
  Slovakia: "SK",
  Hungary: "HU",
  Poland: "PL",
  Austria: "AT",
  Germany: "DE",
};

interface StepResult {
  step: string;
  path: string;
  payload: unknown;
  status: "ok" | "failed" | "skipped";
  response?: unknown;
  error?: { message: string; status: number; code?: string; details?: unknown };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  if (!channexConfigured()) {
    return NextResponse.json({ error: "CHANNEX_API_KEY is not set on this deployment" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const apply = searchParams.get("apply") === "true";

  if (!propertyId) {
    const properties = await prisma.property.findMany({
      where: { ownerId: session.user.id },
      select: {
        id: true, name: true, city: true, country: true, currency: true,
        timezone: true, channelProvider: true,
        channexListing: { select: { channexPropertyId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      message: "Pass ?propertyId=<id> to dry-run provisioning for one property.",
      warning: "Use a throwaway test property first, not a live one.",
      properties,
    });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    include: { channexListing: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  if (property.channexListing) {
    return NextResponse.json({
      status: "already provisioned - nothing written",
      property: { id: property.id, name: property.name },
      listing: property.channexListing,
    });
  }

  // Channex requires a group; the account already has one, and the sandbox
  // has exactly a single group, so it is resolved rather than hardcoded.
  let groupId: string | null = null;
  let groupLookup: unknown = null;
  try {
    const groups = await channexGet<Array<{ id: string; attributes?: { title?: string } }>>("/groups");
    groupLookup = groups.data;
    groupId = groups.data?.[0]?.id ?? null;
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json(
      { error: "Could not read /groups", detail: { message: e.message, status: e.status, code: e.code } },
      { status: 502 }
    );
  }
  if (!groupId) {
    return NextResponse.json({ error: "No Channex group found on this account", groupLookup }, { status: 400 });
  }

  // Coordinates aren't stored in StayHQ. Channex is expected to want them,
  // so they're overridable per request rather than invented silently.
  const lat = searchParams.get("lat") || "48.1486";
  const lng = searchParams.get("lng") || "17.1077";

  // StayHQ stores the country as a free-text name ("Romania"); Channex
  // requires ISO 3166-1 alpha-2 ("RO") - confirmed by a real 422 here
  // ("country should be at most 2 character(s)"). Resolved rather than
  // guessed: an unmapped name fails with a clear message instead of sending
  // Channex something silently wrong.
  const countryCode = searchParams.get("countryCode") || COUNTRY_TO_ISO2[property.country.trim()];
  if (!countryCode) {
    return NextResponse.json(
      {
        error: `No ISO 3166-1 alpha-2 code known for country "${property.country}"`,
        hint: "Pass ?countryCode=XX (e.g. RO) to override, or add it to COUNTRY_TO_ISO2 in this route.",
      },
      { status: 400 }
    );
  }

  const propertyPayload = {
    property: {
      title: property.name,
      currency: property.currency,
      email: session.user.email ?? undefined,
      country: countryCode,
      city: property.city,
      address: property.address,
      zip_code: searchParams.get("zip") || "00000",
      latitude: lat,
      longitude: lng,
      timezone: searchParams.get("timezone") || (property.timezone && property.timezone !== "UTC" ? property.timezone : "Europe/Bratislava"),
      property_type: "apartment",
      group_id: groupId,
    },
  };

  const steps: StepResult[] = [];

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing was created on Channex",
      property: { id: property.id, name: property.name },
      resolvedGroupId: groupId,
      plannedRequests: [
        { step: "1. create property", path: "/properties", payload: propertyPayload },
        {
          step: "2. create room type",
          path: "/room_types",
          payload: { room_type: { property_id: "<from step 1>", title: `${property.name} - entire place`, count_of_rooms: 1, occ_adults: property.maxGuests, occ_children: 0, occ_infants: 0, default_occupancy: property.maxGuests, room_kind: "room" } },
        },
        {
          step: "3. create rate plan",
          path: "/rate_plans",
          payload: { rate_plan: { property_id: "<from step 1>", room_type_id: "<from step 2>", title: "Standard Rate", currency: property.currency, sell_mode: "per_room", rate_mode: "manual", options: [{ occupancy: property.maxGuests, is_primary: true, rate: 0 }] } },
        },
      ],
      nextStep: "Add &apply=true to actually create these on Channex.",
    });
  }

  // --- 1. property ---
  let channexPropertyId: string;
  try {
    const created = await channexPost<{ id: string }>("/properties", propertyPayload);
    channexPropertyId = created.data.id;
    steps.push({ step: "1. create property", path: "/properties", payload: propertyPayload, status: "ok", response: created.data });
  } catch (err) {
    const e = err as ChannexError;
    steps.push({
      step: "1. create property", path: "/properties", payload: propertyPayload, status: "failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
    return NextResponse.json({ status: "failed at step 1", steps }, { status: 502 });
  }

  // --- 2. room type ---
  const roomTypePayload = {
    room_type: {
      property_id: channexPropertyId,
      title: `${property.name} - entire place`,
      count_of_rooms: 1,
      occ_adults: property.maxGuests,
      occ_children: 0,
      occ_infants: 0,
      default_occupancy: property.maxGuests,
      room_kind: "room",
    },
  };
  let channexRoomTypeId: string;
  try {
    const created = await channexPost<{ id: string }>("/room_types", roomTypePayload);
    channexRoomTypeId = created.data.id;
    steps.push({ step: "2. create room type", path: "/room_types", payload: roomTypePayload, status: "ok", response: created.data });
  } catch (err) {
    const e = err as ChannexError;
    steps.push({
      step: "2. create room type", path: "/room_types", payload: roomTypePayload, status: "failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
    return NextResponse.json(
      { status: "failed at step 2", createdSoFar: { channexPropertyId }, steps },
      { status: 502 }
    );
  }

  // --- 3. rate plan ---
  const ratePlanPayload = {
    rate_plan: {
      property_id: channexPropertyId,
      room_type_id: channexRoomTypeId,
      title: "Standard Rate",
      currency: property.currency,
      sell_mode: "per_room",
      rate_mode: "manual",
      options: [{ occupancy: property.maxGuests, is_primary: true, rate: 0 }],
    },
  };
  let channexRatePlanId: string;
  try {
    const created = await channexPost<{ id: string }>("/rate_plans", ratePlanPayload);
    channexRatePlanId = created.data.id;
    steps.push({ step: "3. create rate plan", path: "/rate_plans", payload: ratePlanPayload, status: "ok", response: created.data });
  } catch (err) {
    const e = err as ChannexError;
    steps.push({
      step: "3. create rate plan", path: "/rate_plans", payload: ratePlanPayload, status: "failed",
      error: { message: e.message, status: e.status, code: e.code, details: e.details },
    });
    return NextResponse.json(
      { status: "failed at step 3", createdSoFar: { channexPropertyId, channexRoomTypeId }, steps },
      { status: 502 }
    );
  }

  const listing = await prisma.channexListing.create({
    data: { propertyId: property.id, channexPropertyId, channexRoomTypeId, channexRatePlanId },
  });

  return NextResponse.json({
    status: "provisioned",
    property: { id: property.id, name: property.name },
    listing,
    steps,
    nextStep: "Read the objects back with /api/debug/channex-probe?path=/properties to confirm they exist on Channex.",
  });
}
