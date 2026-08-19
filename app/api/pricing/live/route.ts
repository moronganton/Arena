import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { smoobuProvider } from "@/lib/channels/smoobu-provider";

// GET /api/pricing/live?propertyId=...&start=YYYY-MM-DD&end=YYYY-MM-DD
// Read-only mirror of the property's live prices in Smoobu (set by PriceLabs).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!propertyId || !start || !end) {
    return NextResponse.json({ error: "propertyId, start and end are required" }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    select: { id: true, currency: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const mapping = await prisma.channelConfig.findFirst({
    where: { channel: "SMOOBU", propertyId, property: { ownerId: session.user.id } },
    select: { listingId: true },
  });
  if (!mapping?.listingId) {
    return NextResponse.json({ connected: false, currency: property.currency, rates: {} });
  }

  try {
    const rates = await smoobuProvider.getRates(session.user.id, mapping.listingId, start, end);
    return NextResponse.json({ connected: true, currency: property.currency, rates });
  } catch (err) {
    return NextResponse.json(
      { connected: true, currency: property.currency, rates: {}, error: err instanceof Error ? err.message : "Failed to read rates" },
      { status: 502 }
    );
  }
}
