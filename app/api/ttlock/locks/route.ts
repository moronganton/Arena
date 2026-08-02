import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  propertyId: z.string(),
  ttlockId: z.string(),
  name: z.string().min(1),
  lockType: z.enum(["PIN", "CARD", "FINGERPRINT"]).default("PIN"),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");

  const locks = await prisma.smartLock.findMany({
    where: {
      property: { ownerId: session!.user!.id },
      ...(propertyId ? { propertyId } : {}),
    },
    include: {
      property: { select: { id: true, name: true } },
      _count: { select: { accessCodes: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(locks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: parsed.data.propertyId, ownerId: session!.user!.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const lock = await prisma.smartLock.create({
    data: parsed.data,
  });

  return NextResponse.json(lock, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ...data } = await req.json();
  const lock = await prisma.smartLock.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!lock) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If remapping to another property, verify the target belongs to this user
  if (data.propertyId && data.propertyId !== lock.propertyId) {
    const target = await prisma.property.findFirst({
      where: { id: data.propertyId, ownerId: session!.user!.id },
    });
    if (!target) return NextResponse.json({ error: "Target property not found" }, { status: 404 });
  }

  const updated = await prisma.smartLock.update({
    where: { id },
    data: {
      name: data.name,
      isActive: data.isActive,
      batteryLevel: data.batteryLevel,
      propertyId: data.propertyId,
      checkInTime: data.checkInTime,
      checkOutTime: data.checkOutTime,
    },
    include: {
      property: { select: { id: true, name: true } },
      _count: { select: { accessCodes: true } },
    },
  });

  return NextResponse.json(updated);
}
