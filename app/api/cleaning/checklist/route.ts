import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CHECKLIST } from "@/lib/cleaning";

async function ownedProperty(userId: string, propertyId: string) {
  return prisma.property.findFirst({ where: { id: propertyId, ownerId: userId } });
}

// GET ?propertyId — the property's checklist (custom if defined, else default template)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  if (!(await ownedProperty(session.user.id, propertyId))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const items = await prisma.cleaningChecklistItem.findMany({
    where: { propertyId, active: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });

  if (items.length > 0) {
    return NextResponse.json({ custom: true, items });
  }

  return NextResponse.json({
    custom: false,
    items: DEFAULT_CHECKLIST.map((d, i) => ({ id: `default-${i}`, ...d, sortOrder: i })),
  });
}

// POST — customize (copy default) or add a single item
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { propertyId } = body;
  if (!propertyId || !(await ownedProperty(session.user.id, propertyId))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // Copy the default template into editable custom items
  if (body.action === "customize") {
    const existing = await prisma.cleaningChecklistItem.count({ where: { propertyId } });
    if (existing === 0) {
      await prisma.cleaningChecklistItem.createMany({
        data: DEFAULT_CHECKLIST.map((d, i) => ({
          propertyId,
          category: d.category,
          label: d.label,
          sortOrder: i,
        })),
      });
    }
    return NextResponse.json({ success: true });
  }

  // Add a single item
  if (!body.label || !body.category) {
    return NextResponse.json({ error: "category and label required" }, { status: 400 });
  }
  const maxOrder = await prisma.cleaningChecklistItem.aggregate({
    where: { propertyId },
    _max: { sortOrder: true },
  });
  const item = await prisma.cleaningChecklistItem.create({
    data: {
      propertyId,
      category: body.category,
      label: body.label,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json(item, { status: 201 });
}

// PATCH — edit an item's label or category
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, label, category } = await req.json();
  const item = await prisma.cleaningChecklistItem.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.cleaningChecklistItem.update({
    where: { id },
    data: { label, category },
  });
  return NextResponse.json(updated);
}

// DELETE ?id — remove an item; ?propertyId&action=reset — revert to default template
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const propertyId = searchParams.get("propertyId");
  const action = searchParams.get("action");

  if (action === "reset" && propertyId) {
    if (!(await ownedProperty(session.user.id, propertyId))) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    await prisma.cleaningChecklistItem.deleteMany({ where: { propertyId } });
    return NextResponse.json({ success: true, reset: true });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const item = await prisma.cleaningChecklistItem.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.cleaningChecklistItem.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
