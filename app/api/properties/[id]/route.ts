import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    },
  });

  return NextResponse.json(updated);
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
