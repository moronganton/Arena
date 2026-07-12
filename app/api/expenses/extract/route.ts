import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractInvoiceData } from "@/lib/finance";

// POST { image: dataUrl } — AI-extract expense fields from an invoice photo
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { image } = await req.json();
  if (!image) return NextResponse.json({ error: "image required" }, { status: 400 });

  const properties = await prisma.property.findMany({
    where: { ownerId: session.user.id, active: true },
    select: { id: true, name: true },
  });

  try {
    const extracted = await extractInvoiceData(image, properties.map((p) => p.name));

    // Resolve the property name back to an ID
    const matchedProperty = extracted.propertyName
      ? properties.find((p) => p.name === extracted.propertyName)
      : null;

    return NextResponse.json({
      ...extracted,
      propertyId: matchedProperty?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
