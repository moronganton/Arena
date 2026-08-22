import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runFullSyncForProperty } from "@/lib/channels/channex-ari";

// The real product action behind "Force full resync" on the Channels page -
// session-authenticated, reachable from the app itself rather than only a
// debug route. Built specifically so there is something to click if asked to
// trigger a full sync live on the certification screenshare: Channex's own
// anti-pattern list rejects an integration whose only trigger for a required
// behavior is a script or test-only UI, and a header-secret debug endpoint
// reads exactly like that to a reviewer watching the real app.
//
//   POST /api/channex/full-sync   { "propertyId": "..." }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    select: { id: true, name: true, channelProvider: true, channexListing: { select: { id: true } } },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json({ error: `${property.name} isn't on Channex` }, { status: 400 });
  }
  if (!property.channexListing) {
    return NextResponse.json({ error: `${property.name} isn't provisioned on Channex yet` }, { status: 400 });
  }

  const result = await runFullSyncForProperty(property.id, property.name);

  return NextResponse.json({
    property: property.name,
    horizonDays: 500,
    callsFailed: result.callsFailed,
    taskIds: result.taskIds,
  });
}
