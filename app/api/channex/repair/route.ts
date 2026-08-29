import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkListingHealth, repairListing } from "@/lib/channels/channex-listing-repair";

// Is what host24 records about this property still true on Channex, and can
// the missing pieces be rebuilt?
//
//   GET  /api/channex/repair?propertyId=...   - check only
//   POST /api/channex/repair { propertyId }   - rebuild what is missing
async function ownedProperty(propertyId: string, userId: string) {
  return prisma.property.findFirst({ where: { id: propertyId, ownerId: userId }, select: { id: true } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!(await ownedProperty(propertyId, session.user.id))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // Best-effort: Channex being unreachable must not be reported as "your
  // setup is broken", which is a different and much more alarming claim.
  try {
    const health = await checkListingHealth(propertyId);
    return NextResponse.json({ health });
  } catch {
    return NextResponse.json({ health: null });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!(await ownedProperty(propertyId, session.user.id))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const result = await repairListing(propertyId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
