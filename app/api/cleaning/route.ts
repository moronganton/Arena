import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CHECKLIST } from "@/lib/cleaning";

// GET — list cleaning tasks
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const tasks = await prisma.cleaningTask.findMany({
    where: {
      property: { ownerId: session.user.id },
      ...(status ? { status } : {}),
    },
    include: {
      property: { select: { id: true, name: true, city: true } },
      _count: { select: { damageReports: true } },
    },
    orderBy: { scheduledDate: "desc" },
  });

  return NextResponse.json(tasks);
}

// POST — create a cleaning task
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { propertyId, scheduledDate, notes, reservationId } = await req.json();
  if (!propertyId || !scheduledDate) {
    return NextResponse.json({ error: "propertyId and scheduledDate are required" }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    include: { checklistItems: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // Snapshot the checklist: custom items if defined, otherwise the default template
  const items =
    property.checklistItems.length > 0
      ? property.checklistItems.map((i) => ({ category: i.category, label: i.label }))
      : DEFAULT_CHECKLIST;

  const task = await prisma.cleaningTask.create({
    data: {
      propertyId,
      reservationId: reservationId || null,
      scheduledDate: new Date(scheduledDate),
      notes: notes || null,
      checklist: JSON.stringify(items.map((i) => ({ ...i, done: false }))),
    },
    include: { property: { select: { id: true, name: true, city: true } } },
  });

  return NextResponse.json(task, { status: 201 });
}
