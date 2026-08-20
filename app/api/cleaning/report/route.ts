import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface ChecklistEntry {
  category: string;
  label: string;
  done: boolean;
}

// GET ?days=7 — cleaning activity report
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") || "7"), 90);
  const since = new Date(Date.now() - days * 86400000);

  const tasks = await prisma.cleaningTask.findMany({
    where: {
      property: { ownerId: session.user.id },
      scheduledDate: { gte: since },
    },
    // checklist is needed (it is parsed for the done/outstanding counts), but
    // checkInPhotos and checkOutPhotos are not read anywhere in this report -
    // and they are the heavy columns, one task per reservation each holding
    // base64 photo arrays. Selecting explicitly keeps them in the database.
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      notes: true,
      checklist: true,
      checkInAt: true,
      checkOutAt: true,
      createdAt: true,
      property: { select: { id: true, name: true, city: true } },
      damageReports: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { scheduledDate: "desc" },
  });

  const report = tasks.map((t) => {
    const checklist: ChecklistEntry[] = t.checklist ? JSON.parse(t.checklist) : [];
    const done = checklist.filter((c) => c.done);
    const outstanding = checklist.filter((c) => !c.done);

    let durationMinutes: number | null = null;
    if (t.checkInAt && t.checkOutAt) {
      durationMinutes = Math.round((t.checkOutAt.getTime() - t.checkInAt.getTime()) / 60000);
    }

    return {
      id: t.id,
      property: t.property,
      scheduledDate: t.scheduledDate,
      status: t.status,
      notes: t.notes,
      checkInAt: t.checkInAt,
      checkOutAt: t.checkOutAt,
      durationMinutes,
      checklistTotal: checklist.length,
      checklistDone: done.length,
      outstandingItems: outstanding.map((o) => o.label),
      damageReports: t.damageReports.map((d) => ({
        id: d.id,
        description: d.description,
        status: d.status,
        createdAt: d.createdAt,
        photos: d.photos ? (JSON.parse(d.photos) as string[]).length : 0,
      })),
    };
  });

  // Also include open damages not tied to a task in the window
  const allOpenDamages = await prisma.damageReport.findMany({
    where: { property: { ownerId: session.user.id }, status: "OPEN" },
    include: { property: { select: { id: true, name: true, city: true } } },
    orderBy: { createdAt: "desc" },
    // Unlike the tasks above this was not windowed at all - every open damage
    // ever, each carrying its photos, only for those photos to be counted.
    take: 200,
  });

  const completed = report.filter((r) => r.durationMinutes !== null);
  const avgDuration =
    completed.length > 0
      ? Math.round(completed.reduce((s, r) => s + (r.durationMinutes || 0), 0) / completed.length)
      : null;

  return NextResponse.json({
    days,
    summary: {
      totalTasks: report.length,
      completed: report.filter((r) => r.status === "COMPLETED").length,
      inProgress: report.filter((r) => r.status === "IN_PROGRESS").length,
      pending: report.filter((r) => r.status === "PENDING").length,
      avgDurationMinutes: avgDuration,
      openDamages: allOpenDamages.length,
      tasksWithOutstandingItems: report.filter((r) => r.status === "COMPLETED" && r.outstandingItems.length > 0).length,
    },
    openDamages: allOpenDamages.map((d) => ({
      id: d.id,
      description: d.description,
      property: d.property,
      createdAt: d.createdAt,
      photos: d.photos ? (JSON.parse(d.photos) as string[]).length : 0,
    })),
    tasks: report,
  });
}
