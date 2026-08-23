import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPut, ChannexError } from "@/lib/channels/channex-core";

// Temporary: diagnosing why PUT /taxes/:id isn't persisting max_nights on
// Sinteu's real tax, even when explicitly sent. Isolates a few payload
// shapes in one deploy cycle rather than burning a live-mutation round trip
// per hypothesis. Delete once the cause is found.
function describeError(err: unknown): unknown {
  const e = err as ChannexError;
  if (e instanceof Error) return { message: e.message, status: e.status, code: e.code, details: e.details };
  return String(err);
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const property = await prisma.property.findFirst({
    where: { ownerId: access.userId, channelProvider: "CHANNEX" },
    select: { name: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property?.channexListing) return NextResponse.json({ error: "No Channex property found" }, { status: 404 });

  const taxId = "cefb8824-b549-4054-98fc-e740bc3fb8bf";
  const results: Record<string, unknown> = {};

  async function readTax() {
    const res = await channexGet<{ id: string; attributes: Record<string, unknown> }>(`/taxes/${taxId}`);
    return res.data?.attributes;
  }

  results.start = await readTax();

  // Attempt 1: minimal payload, only max_nights.
  try {
    const res = await channexPut<{ id: string; attributes: Record<string, unknown> }>(`/taxes/${taxId}`, {
      tax: { max_nights: 60 },
    });
    results.minimalPutResponse = res.data?.attributes;
  } catch (err) {
    results.minimalPutError = describeError(err);
  }
  results.afterMinimal = await readTax();

  // Attempt 2: full payload shape identical to upsertCityTax, max_nights as number.
  try {
    const res = await channexPut<{ id: string; attributes: Record<string, unknown> }>(`/taxes/${taxId}`, {
      tax: {
        title: "City tax",
        currency: "EUR",
        type: "city_tax",
        logic: "per_person_per_night",
        is_inclusive: false,
        rate: "3.50",
        max_nights: 60,
        skip_nights: null,
        applicable_after: null,
        applicable_before: null,
        applicable_date_ranges: [],
      },
    });
    results.fullPutResponse = res.data?.attributes;
  } catch (err) {
    results.fullPutError = describeError(err);
  }
  results.afterFull = await readTax();

  // Attempt 3: max_nights as a string, in case Channex is strict about type.
  try {
    const res = await channexPut<{ id: string; attributes: Record<string, unknown> }>(`/taxes/${taxId}`, {
      tax: { max_nights: "60" },
    });
    results.stringPutResponse = res.data?.attributes;
  } catch (err) {
    results.stringPutError = describeError(err);
  }
  results.afterString = await readTax();

  return NextResponse.json(results);
}
