import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  propertyId: z.string(),
  guestId: z.string().optional(),
  guestName: z.string().optional(),
  guestEmail: z.string().email().optional(),
  guestPhone: z.string().optional(),
  checkIn: z.string(),
  checkOut: z.string(),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
  totalAmount: z.number().optional(),
  currency: z.string().default("EUR"),
  specialRequests: z.string().optional(),
  source: z.string().default("DIRECT"),
  confirmationCode: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const status = searchParams.get("status");
  const source = searchParams.get("source");
  const search = searchParams.get("search");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {
    property: { ownerId: session!.user!.id },
  };

  if (propertyId) where.propertyId = propertyId;
  if (status) where.status = status;
  if (source) where.source = source;
  if (from || to) {
    where.checkIn = {};
    if (from) (where.checkIn as Record<string, unknown>).gte = new Date(from);
    if (to) (where.checkIn as Record<string, unknown>).lte = new Date(to);
  }
  if (search) {
    where.OR = [
      { guest: { name: { contains: search } } },
      { confirmationCode: { contains: search } },
    ];
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: {
      guest: true,
      property: { select: { id: true, name: true, city: true, country: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { checkIn: "asc" },
  });

  return NextResponse.json(reservations);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Verify property ownership
  const property = await prisma.property.findFirst({
    where: { id: data.propertyId, ownerId: session!.user!.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // Get or create guest
  let guestId = data.guestId;
  if (!guestId) {
    const guest = await prisma.guest.create({
      data: {
        name: data.guestName || "Guest",
        email: data.guestEmail,
        phone: data.guestPhone,
      },
    });
    guestId = guest.id;
  }

  const reservation = await prisma.reservation.create({
    data: {
      propertyId: data.propertyId,
      guestId,
      checkIn: new Date(data.checkIn),
      checkOut: new Date(data.checkOut),
      adults: data.adults,
      children: data.children,
      totalAmount: data.totalAmount,
      currency: data.currency,
      specialRequests: data.specialRequests,
      source: data.source,
      confirmationCode: data.confirmationCode,
      status: "CONFIRMED",
    },
    include: { guest: true, property: true },
  });

  return NextResponse.json(reservation, { status: 201 });
}
