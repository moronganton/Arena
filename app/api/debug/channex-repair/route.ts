import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { checkListingHealth, repairListing } from "@/lib/channels/channex-listing-repair";

// Same functions the real endpoint calls, so what this reports is what that
// would do.
//
//   GET /api/debug/channex-repair?propertyId=...[&apply=true]
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const params = new URL(req.url).searchParams;
  const propertyId = params.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  if (params.get("apply") !== "true") {
    const health = await checkListingHealth(propertyId);
    return NextResponse.json({ mode: "check only - add &apply=true to repair", health });
  }
  const result = await repairListing(propertyId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
