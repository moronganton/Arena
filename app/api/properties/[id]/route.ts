import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueAriUpdate, defaultHorizon } from "@/lib/channels/ari-outbox";
import { upsertCityTax, deleteCityTaxForProperty } from "@/lib/channels/channex-taxes";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const property = await prisma.property.findFirst({
    where: { id, ownerId: session!.user!.id },
    include: {
      channels: true,
      locks: true,
      pricingRules: { orderBy: { priority: "desc" } },
      _count: { select: { reservations: true } },
    },
  });

  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(property);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.property.findFirst({
    where: { id, ownerId: session!.user!.id },
    include: { channexListing: { select: { channexPropertyId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.property.update({
    where: { id },
    data: {
      name: body.name,
      address: body.address,
      city: body.city,
      country: body.country,
      description: body.description,
      bedrooms: body.bedrooms,
      bathrooms: body.bathrooms,
      maxGuests: body.maxGuests,
      basePrice: body.basePrice,
      currency: body.currency,
      timezone: body.timezone,
      imageUrl: body.imageUrl,
      active: body.active,
      aiEnabled: body.aiEnabled,
      cityTaxPerNight: body.cityTaxPerNight,
      cityTaxAutoChargeEnabled: body.cityTaxAutoChargeEnabled,
    },
  });

  // basePrice is the floor every rate materializes from - a change here
  // affects every date with no rule overriding it.
  if (body.basePrice != null && body.basePrice !== existing.basePrice) {
    const { from, to } = defaultHorizon();
    await enqueueAriUpdate(id, from, to, "RATE");
  }

  // StayHQ is the single place to configure the rate; Channex's Tax object
  // is what actually makes Booking.com/Airbnb disclose it to the guest -
  // push it here so the two never have to be edited separately again. Only
  // for Channex-managed properties (nothing to push to otherwise), and only
  // when this request actually touched the rate - every other property save
  // (name, description, ...) must not re-hit Channex's API for no reason.
  //
  // Awaited, and its failure reported back rather than only logged: a rate
  // change that silently failed to reach Channex would leave StayHQ's own
  // records and what Booking.com discloses to the guest quietly out of
  // sync, which is the exact problem this sync exists to prevent - the
  // property save itself still succeeds either way, this just says so.
  let channexTaxSyncError: string | null = null;
  if (existing.channexListing && body.cityTaxPerNight !== undefined) {
    const channexPropertyId = existing.channexListing.channexPropertyId;
    try {
      if (body.cityTaxPerNight == null) {
        await deleteCityTaxForProperty(channexPropertyId);
      } else {
        await upsertCityTax(channexPropertyId, updated.currency, Number(body.cityTaxPerNight));
      }
    } catch (err) {
      channexTaxSyncError = err instanceof Error ? err.message : "Failed to sync the rate to Channex";
      console.error(`[properties] failed to sync city tax to Channex for ${id}:`, err);
    }
  }

  return NextResponse.json({ ...updated, channexTaxSyncError });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.property.findFirst({
    where: { id, ownerId: session!.user!.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.property.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ success: true });
}
