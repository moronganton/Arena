import { prisma } from "@/lib/prisma";
import { DEFAULT_CHECKLIST } from "@/lib/cleaning";

export interface ChecklistEntry {
  category: string;
  label: string;
  done: boolean;
}

export interface PriorityJob {
  id: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checklist: ChecklistEntry[];
  property: { id: string; name: string; city: string };
  urgency: "URGENT" | "SOON" | "FLEXIBLE" | "SCHEDULED";
  reservation: { guestName: string; source: string; nights: number; checkOut: string } | null;
  damageCount: number;
}

export interface PriorityDay {
  day: string; // YYYY-MM-DD
  label: string; // "Today · Aug 13", "Tomorrow · Aug 14", "Friday · Aug 15"
  // 0 = today, 1 = tomorrow, ... Decided here, where the offset is already
  // known, so the client never re-derives it from a UTC timestamp - doing
  // that in the browser made "today" read as a future day for any host not
  // on UTC, which locked the action buttons on jobs actually due today.
  dayOffset: number;
  dayWord: string; // "today" | "tomorrow" | "Friday" - for inline sentences
  jobs: PriorityJob[];
}

const URGENCY_RANK: Record<PriorityJob["urgency"], number> = {
  URGENT: 0,
  SOON: 1,
  FLEXIBLE: 2,
  SCHEDULED: 2,
};

function dayLabel(offset: number, date: Date): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

// Reservations checking out today, tomorrow, ... up to `days` days ahead,
// each turned into an actionable cleaning job - creating the CleaningTask on
// the fly if one doesn't exist yet, so every checkout in the window is
// immediately actionable (Check-in / Damage / Check-out) rather than needing
// a separate "create task" step first.
export async function getPriorityDays(ownerId: string, days = 3): Promise<PriorityDay[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + days);

  const checkouts = await prisma.reservation.findMany({
    where: {
      property: { ownerId },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkOut: { gte: today, lt: windowEnd },
    },
    include: {
      guest: { select: { name: true } },
      property: { select: { id: true, name: true, city: true, checklistItems: { where: { active: true }, orderBy: { sortOrder: "asc" } } } },
    },
    orderBy: { checkOut: "asc" },
  });

  if (checkouts.length === 0) return [];

  const propertyIds = Array.from(new Set(checkouts.map((r) => r.property.id)));
  const upcomingArrivals = await prisma.reservation.findMany({
    where: {
      propertyId: { in: propertyIds },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      checkIn: { gte: today },
    },
    select: { propertyId: true, checkIn: true },
    orderBy: { checkIn: "asc" },
  });

  const existingTasks = await prisma.cleaningTask.findMany({
    where: { reservationId: { in: checkouts.map((r) => r.id) } },
  });
  const taskByReservation = new Map(existingTasks.map((t) => [t.reservationId, t]));

  const dayMs = 86400000;
  const byDay = new Map<string, PriorityJob[]>();

  for (const r of checkouts) {
    let task = taskByReservation.get(r.id);
    if (!task) {
      const items =
        r.property.checklistItems.length > 0
          ? r.property.checklistItems.map((i) => ({ category: i.category, label: i.label }))
          : DEFAULT_CHECKLIST;
      task = await prisma.cleaningTask.create({
        data: {
          propertyId: r.property.id,
          reservationId: r.id,
          scheduledDate: r.checkOut,
          notes: `After check-out of ${r.guest.name}`,
          checklist: JSON.stringify(items.map((i) => ({ ...i, done: false }))),
        },
      });
    }

    const next = upcomingArrivals.find(
      (a) => a.propertyId === r.property.id && a.checkIn.getTime() >= r.checkOut.getTime()
    );
    const offset = Math.floor((new Date(r.checkOut).setHours(0, 0, 0, 0) - today.getTime()) / dayMs);
    let urgency: PriorityJob["urgency"] = offset > 0 ? "SCHEDULED" : "FLEXIBLE";
    if (next) {
      const daysUntilNext = Math.round((next.checkIn.getTime() - r.checkOut.getTime()) / dayMs);
      if (daysUntilNext <= 0) urgency = "URGENT";
      else if (daysUntilNext === 1 && offset === 0) urgency = "SOON";
    }

    const nights = Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / dayMs);
    const dayKey = r.checkOut.toISOString().slice(0, 10);
    const job: PriorityJob = {
      id: task.id,
      status: task.status,
      checkInAt: task.checkInAt ? task.checkInAt.toISOString() : null,
      checkOutAt: task.checkOutAt ? task.checkOutAt.toISOString() : null,
      checklist: task.checklist ? JSON.parse(task.checklist) : [],
      property: { id: r.property.id, name: r.property.name, city: r.property.city },
      urgency,
      reservation: { guestName: r.guest.name, source: r.source, nights, checkOut: r.checkOut.toISOString() },
      damageCount: 0,
    };
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(job);
  }

  const damageCounts = await prisma.damageReport.groupBy({
    by: ["cleaningTaskId"],
    where: { cleaningTaskId: { in: Array.from(byDay.values()).flat().map((j) => j.id) } },
    _count: true,
  });
  const damageByTask = new Map(damageCounts.map((d) => [d.cleaningTaskId, d._count]));
  for (const jobs of byDay.values()) {
    for (const job of jobs) job.damageCount = damageByTask.get(job.id) || 0;
  }

  const result: PriorityDay[] = [];
  for (let offset = 0; offset < days; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const key = d.toISOString().slice(0, 10);
    const jobs = byDay.get(key);
    if (!jobs || jobs.length === 0) continue;
    jobs.sort((a, b) => {
      // Completed jobs sink to the bottom regardless of urgency
      const aDone = a.status === "COMPLETED" ? 1 : 0;
      const bDone = b.status === "COMPLETED" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    });
    result.push({
      day: key,
      label: `${dayLabel(offset, d)} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      dayOffset: offset,
      dayWord:
        offset === 0 ? "today" : offset === 1 ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" }),
      jobs,
    });
  }

  return result;
}
