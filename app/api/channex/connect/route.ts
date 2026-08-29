import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Switches an UNCONNECTED property onto Channex, so the rest of the rate plan
// setup can run.
//
// Properties are created with channelProvider "SMOOBU" by default, which means
// a brand new property is indistinguishable from a real Smoobu one by that
// field alone - and converting a live Smoobu listing would silently cut its
// bookings off. The discriminator is a SMOOBU channel row carrying a
// listingId: that is what an actually-mapped Smoobu property has, and this
// route refuses any property that has one.
//
// Provisioning on Channex itself is a separate step (/api/channex/provision),
// which this deliberately does not do: that call creates real objects on a
// live channel manager, and the two failing independently is easier to reason
// about than one half-applied combined step.
//
//   POST /api/channex/connect   { propertyId }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    select: {
      id: true,
      name: true,
      channelProvider: true,
      channexListing: { select: { id: true } },
      channels: { select: { channel: true, listingId: true } },
    },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  if (property.channelProvider === "CHANNEX") {
    return NextResponse.json({ ok: true, alreadyConnected: true });
  }

  const mappedToSmoobu = property.channels.some((c) => c.channel === "SMOOBU" && c.listingId);
  if (mappedToSmoobu) {
    return NextResponse.json(
      {
        error: `${property.name} is mapped to a Smoobu apartment. Moving it to Channex would stop its bookings importing - disconnect it from Smoobu first.`,
      },
      { status: 409 }
    );
  }

  await prisma.property.update({ where: { id: property.id }, data: { channelProvider: "CHANNEX" } });
  return NextResponse.json({ ok: true, needsProvisioning: !property.channexListing });
}
