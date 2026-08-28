import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isAcceptableImageSrc } from "@/lib/image";

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  description: z.string().optional(),
  bedrooms: z.number().int().min(0).default(1),
  bathrooms: z.number().min(0).default(1),
  maxGuests: z.number().int().min(1).default(2),
  basePrice: z.number().min(0).default(100),
  currency: z.string().default("EUR"),
  timezone: z.string().default("UTC"),
  // Not z.string().url(): that accepts javascript: and data:text/html, both
  // of which are stored XSS the moment anything renders the field outside an
  // <img>. isAcceptableImageSrc allows only inline images and http(s), and
  // caps the inline size so a row cannot be bloated.
  imageUrl: z
    .string()
    .refine(isAcceptableImageSrc, "Must be an uploaded image or an http(s) URL")
    .optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const properties = await prisma.property.findMany({
    where: { ownerId: session!.user!.id },
    include: {
      channels: true,
      locks: true,
      _count: { select: { reservations: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(properties);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const property = await prisma.property.create({
    data: { ...parsed.data, ownerId: session!.user!.id },
  });

  return NextResponse.json(property, { status: 201 });
}
