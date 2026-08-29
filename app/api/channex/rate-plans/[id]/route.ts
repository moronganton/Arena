import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { updateRatePlan, removeRatePlan, removeUntrackedRatePlan } from "@/lib/channels/channex-rate-plans";

// Editing and removing one plan in a family.
//
//   PATCH  /api/channex/rate-plans/{id}   { propertyId, title?, derivedPercent?, minStayArrival? }
//   DELETE /api/channex/rate-plans/{id}?propertyId=...
//
// Both go through requireChannexProperty, so a plan can only be touched by the
// owner of the Channex property it belongs to - the same gate that keeps every
// other Channex feature off the Smoobu listings.

const patchSchema = z.object({
  propertyId: z.string().min(1),
  title: z.string().min(1).optional(),
  derivedPercent: z.number().optional(),
  minStayArrival: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { propertyId, ...changes } = parsed.data;

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { maxGuests: true },
  });

  const res = await updateRatePlan(guard.channexListingId, id, changes, property.maxGuests);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, problems: res.problems, details: res.details },
      { status: res.problems ? 400 : 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    // An id prefixed "channex:" addresses a plan that exists on Channex but is
  // not tracked here - a retired one - which has no host24 row to look up.
  const res = id.startsWith("channex:")
    ? await removeUntrackedRatePlan(guard.channexListingId, guard.channexPropertyId, id.slice("channex:".length))
    : await removeRatePlan(guard.channexListingId, id);
  if (!res.ok) return NextResponse.json({ error: res.error, details: res.details }, { status: 409 });
  return NextResponse.json({ ok: true });
}
