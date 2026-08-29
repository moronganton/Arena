import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deletePropertyForGood, describeBlockers } from "@/lib/properties/delete-property";
import { enqueueAriUpdate, defaultHorizon } from "@/lib/channels/ari-outbox";
import { upsertCityTax, deleteChannexTax } from "@/lib/channels/channex-taxes";
import { isAcceptableImageSrc } from "@/lib/image";

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

  // This route takes the body largely unvalidated, which is tolerable for
  // scalars but not for imageUrl: it is the one field that can carry an
  // arbitrary URL scheme into something later rendered as a src.
  if (body.imageUrl != null && body.imageUrl !== "" && !isAcceptableImageSrc(String(body.imageUrl))) {
    return NextResponse.json(
      { error: "imageUrl must be an uploaded image or an http(s) URL" },
      { status: 400 }
    );
  }
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
      cityTaxTitle: body.cityTaxTitle,
      cityTaxIsInclusive: body.cityTaxIsInclusive,
      cityTaxLogic: body.cityTaxLogic,
      cityTaxType: body.cityTaxType,
      cityTaxMaxNights: body.cityTaxMaxNights,
      cityTaxSkipNights: body.cityTaxSkipNights,
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
  let cityTaxChannexId = updated.cityTaxChannexId;
  if (existing.channexListing && body.cityTaxPerNight !== undefined) {
    const channexPropertyId = existing.channexListing.channexPropertyId;
    try {
      if (body.cityTaxPerNight == null) {
        if (existing.cityTaxChannexId) {
          await deleteChannexTax(existing.cityTaxChannexId);
          cityTaxChannexId = null;
          await prisma.property.update({ where: { id }, data: { cityTaxChannexId: null } });
        }
      } else {
        const tax = await upsertCityTax(channexPropertyId, existing.cityTaxChannexId, {
          title: updated.cityTaxTitle,
          currency: updated.currency,
          type: updated.cityTaxType,
          logic: updated.cityTaxLogic,
          isInclusive: updated.cityTaxIsInclusive,
          rate: Number(updated.cityTaxPerNight),
          maxNights: updated.cityTaxMaxNights,
          skipNights: updated.cityTaxSkipNights,
        });
        if (tax.id !== existing.cityTaxChannexId) {
          cityTaxChannexId = tax.id;
          await prisma.property.update({ where: { id }, data: { cityTaxChannexId: tax.id } });
        }
      }
    } catch (err) {
      channexTaxSyncError = err instanceof Error ? err.message : "Failed to sync the rate to Channex";
      console.error(`[properties] failed to sync city tax to Channex for ${id}:`, err);
    }
  }

  return NextResponse.json({ ...updated, cityTaxChannexId, channexTaxSyncError });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.property.findFirst({
    where: { id, ownerId: session!.user!.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ?purge=true is a real delete; without it this stays what it always was,
  // a deactivation. Two very different outcomes should not share one button
  // by default - a listing that stops trading is hidden, a property created
  // by mistake is removed.
  if (new URL(req.url).searchParams.get("purge") === "true") {
    const res = await deletePropertyForGood(id, session!.user!.id);
    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.blockers
            ? `This property still has ${describeBlockers(res.blockers)}. Deleting it would take those with it, so it can only be deactivated.`
            : res.error,
          blockers: res.blockers,
        },
        { status: res.blockers ? 409 : 404 }
      );
    }
    return NextResponse.json({ success: true, deleted: true, channexNote: res.channexNote });
  }

  await prisma.property.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ success: true, deleted: false });
}
