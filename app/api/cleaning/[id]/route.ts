import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — task detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.cleaningTask.findFirst({
    where: { id, property: { ownerId: session.user.id } },
    include: {
      property: { select: { id: true, name: true, city: true, address: true } },
      damageReports: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(task);
}

// PATCH — actions: checkin, checkout, update checklist/notes
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.cleaningTask.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();

  if (body.action === "checkin") {
    const updated = await prisma.cleaningTask.update({
      where: { id },
      data: {
        checkInAt: new Date(),
        checkInPhotos: JSON.stringify(body.photos || []),
        status: "IN_PROGRESS",
      },
    });
    return NextResponse.json(updated);
  }

  if (body.action === "checkout") {
    if (!task.checkInAt) {
      return NextResponse.json({ error: "Check in first before checking out" }, { status: 400 });
    }
    const updated = await prisma.cleaningTask.update({
      where: { id },
      data: {
        checkOutAt: new Date(),
        checkOutPhotos: JSON.stringify(body.photos || []),
        status: "COMPLETED",
      },
    });
    return NextResponse.json(updated);
  }

  // Generic update: checklist state / notes
  const updated = await prisma.cleaningTask.update({
    where: { id },
    data: {
      checklist: body.checklist !== undefined ? JSON.stringify(body.checklist) : undefined,
      notes: body.notes !== undefined ? body.notes : undefined,
    },
  });
  return NextResponse.json(updated);
}

// DELETE — remove a task
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.cleaningTask.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.damageReport.updateMany({
    where: { cleaningTaskId: id },
    data: { cleaningTaskId: null },
  });
  await prisma.cleaningTask.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
