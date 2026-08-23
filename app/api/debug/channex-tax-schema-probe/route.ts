import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexPost, channexDelete, ChannexError } from "@/lib/channels/channex-core";

// One-off schema discovery for Channex's Taxes/Tax Sets collections -
// docs.channex.io is blocked by this sandbox's egress policy (same as every
// other Channex collection built this way), and the account has zero taxes
// created yet (GET /taxes and /tax_sets both return an empty list), so
// there's no real object to read back. Same technique used for Hotel
// Policy: POST an empty payload first to read the required-field errors
// Channex's own validator returns, then iterate to a real create.
//
//   GET /api/debug/channex-tax-schema-probe                 -> empty-payload probes only
//   GET /api/debug/channex-tax-schema-probe?create=true      -> also creates a real tax
//   GET /api/debug/channex-tax-schema-probe?create=true&taxSetId=<id>  -> tax under a set
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
  const channexPropertyId = property.channexListing.channexPropertyId;

  const { searchParams } = new URL(req.url);
  const create = searchParams.get("create") === "true";
  const taxSetId = searchParams.get("taxSetId");

  const results: Record<string, unknown> = { property: property.name, channexPropertyId };

  // Empty-payload probes - the validator's error lists every required field.
  try {
    await channexPost("/tax_sets", { tax_set: {} });
  } catch (err) {
    results.emptyTaxSetError = describeError(err);
  }
  try {
    await channexPost("/taxes", { tax: {} });
  } catch (err) {
    results.emptyTaxError = describeError(err);
  }
  // Also try a tax scoped to a property directly, in case that's a required
  // association instead of (or alongside) a tax_set.
  try {
    await channexPost("/taxes", { tax: { property_id: channexPropertyId } });
  } catch (err) {
    results.emptyTaxWithPropertyError = describeError(err);
  }

  // Invalid enum values often make a validator list every value it does
  // accept - cheaper than guessing from a closed UI dropdown screenshot.
  try {
    await channexPost("/taxes", {
      tax: { title: "probe", currency: "EUR", property_id: channexPropertyId, rate: "1", logic: "not_a_real_logic_value" },
    });
  } catch (err) {
    results.invalidLogicError = describeError(err);
  }
  try {
    await channexPost("/taxes", {
      tax: { title: "probe", currency: "EUR", property_id: channexPropertyId, rate: "1", logic: "per_person_per_night", type: "not_a_real_type_value" },
    });
  } catch (err) {
    results.invalidTypeError = describeError(err);
  }

  // Confirms the wire values behind Channex's "Type" and "Logic" dropdowns
  // (Tax/City tax/Fee, and Percent/Per booking/Per room/Per night/Per
  // person/Per room per night/Per person per night) - guessed as lowercase
  // snake_case by analogy with every other Channex enum in this codebase,
  // but not worth shipping on analogy alone. Creates one throwaway tax with
  // the two least-obvious guesses (type "fee", logic "per_booking"),
  // confirms it round-trips, then deletes it - type "fee" can never collide
  // with the real city_tax lookup other code uses, so this is safe to run
  // against the live account.
  if (searchParams.get("verifyEnums") === "true") {
    try {
      const createRes = await channexPost<{ id: string; attributes: Record<string, unknown> }>("/taxes", {
        tax: {
          property_id: channexPropertyId,
          title: "StayHQ enum probe - safe to delete",
          currency: "EUR",
          type: "fee",
          logic: "per_booking",
          is_inclusive: false,
          rate: "1.00",
        },
      });
      results.enumProbeCreated = createRes.data?.attributes;
      const probeId = createRes.data?.id;
      if (probeId) {
        await channexDelete(`/taxes/${probeId}`);
        results.enumProbeDeleted = true;
      }
    } catch (err) {
      results.enumProbeError = describeError(err);
    }
    return NextResponse.json(results);
  }

  if (create) {
    // Real data: Bratislava's actual city tax, 3.5 EUR per person per
    // night, exclusive of the room rate - the same figure already live in
    // StayHQ's own city-tax feature (lib/city-tax.ts).
    try {
      const taxSetRes = await channexPost<{ id: string; attributes: Record<string, unknown> }>("/tax_sets", {
        tax_set: { title: "Bratislava city tax", property_id: channexPropertyId },
      });
      results.createdTaxSet = taxSetRes;
    } catch (err) {
      results.createTaxSetError = describeError(err);
    }

    const resolvedTaxSetId = taxSetId || (results.createdTaxSet as { id?: string } | undefined)?.id;
    try {
      const taxPayload: Record<string, unknown> = {
        title: "City tax",
        is_inclusive: false,
        logic: "per_person_per_night",
        type: "city_tax",
        currency: "EUR",
        rate: "3.5",
        property_id: channexPropertyId,
      };
      if (resolvedTaxSetId) taxPayload.tax_set_id = resolvedTaxSetId;
      const taxRes = await channexPost<{ id: string; attributes: Record<string, unknown> }>("/taxes", { tax: taxPayload });
      results.createdTax = taxRes;
    } catch (err) {
      results.createTaxError = describeError(err);
    }
  }

  return NextResponse.json(results);
}
