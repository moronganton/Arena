import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { listFacilityOptions, getPropertyFacilityIds, setPropertyFacilityIds } from "@/lib/channels/channex-facilities";
import { ChannexError } from "@/lib/channels/channex-core";

//   GET /api/channex/facilities?propertyId=...   -> { property, options, selectedIds }
//   PUT /api/channex/facilities  { propertyId, facilityIds: [...] }
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const [options, selectedIds] = await Promise.all([
      listFacilityOptions(),
      getPropertyFacilityIds(guard.channexPropertyId),
    ]);
    return NextResponse.json({ property: guard.propertyName, options, selectedIds });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  const facilityIds = body?.facilityIds as string[] | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!Array.isArray(facilityIds)) return NextResponse.json({ error: "facilityIds must be an array" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const selectedIds = await setPropertyFacilityIds(guard.channexPropertyId, facilityIds);
    return NextResponse.json({ property: guard.propertyName, selectedIds });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status || 502 });
  }
}
