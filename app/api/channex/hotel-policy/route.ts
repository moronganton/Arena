import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { getHotelPolicyForProperty, upsertHotelPolicy, type HotelPolicyFields } from "@/lib/channels/channex-hotel-policy";
import { ChannexError } from "@/lib/channels/channex-core";

//   GET  /api/channex/hotel-policy?propertyId=...
//   PUT  /api/channex/hotel-policy   { propertyId, ...HotelPolicyFields }
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const policy = await getHotelPolicyForProperty(guard.channexPropertyId);
    return NextResponse.json({ property: guard.propertyName, policy });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { propertyId, ...fields } = body as { propertyId?: string } & Partial<HotelPolicyFields>;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const policy = await upsertHotelPolicy(guard.channexPropertyId, fields as HotelPolicyFields);
    return NextResponse.json({ property: guard.propertyName, policy });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status || 502 });
  }
}
