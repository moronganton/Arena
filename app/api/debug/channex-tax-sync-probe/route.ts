import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { getCityTaxForProperty, upsertCityTax } from "@/lib/channels/channex-taxes";

// Verifies upsertCityTax's UPDATE path (PUT /taxes/:id) against the real
// city tax this account already created manually on Sinteu, before wiring
// this into the property save path. Reads it back both before and after so
// the preserved-fields claim (max_nights etc. untouched) is checked, not
// assumed.
//
//   GET /api/debug/channex-tax-sync-probe?apply=true
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const property = await prisma.property.findFirst({
    where: { ownerId: access.userId, channelProvider: "CHANNEX" },
    select: { name: true, currency: true, channexListing: { select: { channexPropertyId: true } } },
  });
  if (!property?.channexListing) return NextResponse.json({ error: "No Channex property found" }, { status: 404 });
  const channexPropertyId = property.channexListing.channexPropertyId;

  const before = await getCityTaxForProperty(channexPropertyId);
  const apply = new URL(req.url).searchParams.get("apply") === "true";

  if (!apply) {
    return NextResponse.json({ property: property.name, before, note: "Dry run - add &apply=true to actually PUT." });
  }

  const updated = await upsertCityTax(channexPropertyId, property.currency, 3.5);
  const after = await getCityTaxForProperty(channexPropertyId);

  return NextResponse.json({ property: property.name, before, updated, after });
}
