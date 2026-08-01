import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatShortDate, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, MessageSquareWarning, Bot, ListChecks, CalendarRange } from "lucide-react";
import { DashboardKpis } from "@/components/dashboard/DashboardKpis";
import { OpenTasks, type Task } from "@/components/dashboard/OpenTasks";

const HORIZON = 10; // nights shown in gap occupancy

async function getDashboardData(userId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  // UTC day boundaries for the occupancy grid (matches how OTA dates are stored)
  const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcHorizonEnd = new Date(utcToday.getTime() + HORIZON * 86400000);

  const [
    properties, monthRevenue, checkInsToday, aiRepliesToday,
    cleaningTotalToday, cleaningDoneToday,
    attentionRaw, needsReplyCount, aiRepliedRaw, noteTasks, damageTasks, gapProps, gapRes, gapBlocks, recentReservations,
  ] = await Promise.all([
    prisma.property.count({ where: { ownerId: userId, active: true } }),
    prisma.reservation.aggregate({
      where: { property: { ownerId: userId }, status: { not: "CANCELLED" }, checkIn: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { totalAmount: true },
    }),
    prisma.reservation.count({
      where: { property: { ownerId: userId }, status: { notIn: ["CANCELLED", "NO_SHOW"] }, checkIn: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.message.count({
      where: { isAiGenerated: true, direction: "OUTBOUND", createdAt: { gte: todayStart, lt: todayEnd }, reservation: { property: { ownerId: userId } } },
    }),
    prisma.cleaningTask.count({ where: { scheduledDate: { gte: todayStart, lt: todayEnd }, property: { ownerId: userId } } }),
    prisma.cleaningTask.count({ where: { scheduledDate: { gte: todayStart, lt: todayEnd }, status: "COMPLETED", property: { ownerId: userId } } }),
    prisma.message.findMany({
      where: { needsHostReply: true, direction: "INBOUND", reservation: { property: { ownerId: userId } } },
      include: { reservation: { select: { id: true, guest: { select: { name: true } }, property: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" }, take: 8,
    }),
    prisma.message.count({
      where: { needsHostReply: true, direction: "INBOUND", reservation: { property: { ownerId: userId } } },
    }),
    prisma.message.findMany({
      where: { isAiGenerated: true, direction: "OUTBOUND", reservation: { property: { ownerId: userId } } },
      include: { reservation: { select: { id: true, guest: { select: { name: true } }, property: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" }, take: 10,
    }),
    prisma.message.findMany({
      where: { channel: "INTERNAL", taskDone: false, reservation: { property: { ownerId: userId } } },
      include: { reservation: { select: { id: true, property: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" }, take: 12,
    }),
    prisma.damageReport.findMany({
      where: { status: "OPEN", property: { ownerId: userId } },
      include: { property: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 12,
    }),
    prisma.property.findMany({ where: { ownerId: userId, active: true }, select: { id: true, name: true, city: true } }),
    prisma.reservation.findMany({
      where: { property: { ownerId: userId }, status: { not: "CANCELLED" }, checkOut: { gt: utcToday }, checkIn: { lt: utcHorizonEnd } },
      select: { propertyId: true, checkIn: true, checkOut: true },
    }),
    prisma.calendarBlock.findMany({
      where: { property: { ownerId: userId }, endDate: { gte: utcToday }, startDate: { lt: utcHorizonEnd } },
      select: { propertyId: true, startDate: true, endDate: true },
    }),
    prisma.reservation.findMany({
      where: { property: { ownerId: userId }, status: { not: "CANCELLED" } },
      include: { guest: true, property: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 6,
    }),
  ]);

  // For each AI reply, find the guest question it answered (the most recent
  // inbound, non-internal message just before it in the same thread).
  const aiQuestions = await Promise.all(
    aiRepliedRaw.map((m) =>
      prisma.message.findFirst({
        where: { reservationId: m.reservationId, direction: "INBOUND", channel: { not: "INTERNAL" }, createdAt: { lt: m.createdAt } },
        orderBy: { createdAt: "desc" }, select: { body: true },
      })
    )
  );

  // --- Gap occupancy: for each property, the state of the next HORIZON nights ---
  const nights = Array.from({ length: HORIZON }, (_, i) => new Date(utcToday.getTime() + i * 86400000).getTime());
  const occupancy = gapProps.map((p) => {
    const res = gapRes.filter((r) => r.propertyId === p.id);
    const blk = gapBlocks.filter((b) => b.propertyId === p.id);
    const states = nights.map((n) => {
      if (res.some((r) => r.checkIn.getTime() <= n && r.checkOut.getTime() > n)) return "b"; // booked
      if (blk.some((b) => b.startDate.getTime() <= n && b.endDate.getTime() >= n)) return "x"; // blocked
      return "o"; // open / gap
    });
    const firstGap = states.indexOf("o");
    return { id: p.id, name: p.name, city: p.city, states, firstGap: firstGap === -1 ? 999 : firstGap };
  }).sort((a, b) => a.firstGap - b.firstGap || a.name.localeCompare(b.name));

  // --- Merge tasks (internal notes + open damages), newest first ---
  const tasks: (Task & { at: number })[] = [
    ...noteTasks.map((m) => ({
      kind: "note" as const, id: m.id, text: m.body.replace(/\s+/g, " ").trim().slice(0, 120),
      property: m.reservation.property.name, meta: "internal note", href: `/reservations/${m.reservation.id}`, at: m.createdAt.getTime(),
    })),
    ...damageTasks.map((d) => ({
      kind: "damage" as const, id: d.id, text: d.description.replace(/\s+/g, " ").trim().slice(0, 120),
      property: d.property.name, meta: "reported by cleaner", href: "/cleaning", at: d.createdAt.getTime(),
    })),
  ].sort((a, b) => b.at - a.at).slice(0, 12);

  return {
    properties,
    monthRevenue: monthRevenue._sum.totalAmount || 0,
    checkInsToday, aiRepliesToday, cleaningTotalToday, cleaningDoneToday,
    needsReplyCount,
    attention: attentionRaw.map((m) => ({
      reservationId: m.reservation.id, property: m.reservation.property.name,
      guest: m.reservation.guest.name, question: m.body.replace(/\s+/g, " ").trim().slice(0, 120),
    })),
    aiReplied: aiRepliedRaw.map((m, i) => ({
      reservationId: m.reservation.id, property: m.reservation.property.name,
      question: aiQuestions[i]?.body ? aiQuestions[i]!.body.replace(/\s+/g, " ").trim().slice(0, 110) : null,
      reply: m.body.replace(/\s+/g, " ").trim().slice(0, 160),
    })),
    tasks: tasks.map(({ at: _at, ...t }) => t) as Task[],
    occupancy,
    recentReservations,
  };
}

export default async function DashboardPage() {
  const session = await auth();
  const d = await getDashboardData(session!.user.id);
  const firstName = (session!.user.name || "").split(" ")[0];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{firstName ? `Good day, ${firstName}` : "Dashboard"} 👋</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · here&apos;s your day
        </p>
      </div>

      {/* ①–⑤ compact KPIs */}
      <DashboardKpis
        properties={d.properties}
        revenue={formatCurrency(d.monthRevenue)}
        checkInsToday={d.checkInsToday}
        aiRepliesToday={d.aiRepliesToday}
        cleaningDone={d.cleaningDoneToday}
        cleaningTotal={d.cleaningTotalToday}
        needsReply={d.needsReplyCount}
      />

      {/* ⑥ needs reply + AI replied (monitor how the AI answers) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <MessageSquareWarning className="w-4 h-4 text-rose-500" />
            <span className="text-sm font-semibold text-slate-900">Needs your reply</span>
            {d.needsReplyCount > 0 && <span className="ml-auto text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">{d.needsReplyCount}</span>}
          </div>
          {d.attention.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No guest questions waiting. 🎉</p>
          ) : (
            d.attention.map((a) => (
              <Link key={a.reservationId} href={`/reservations/${a.reservationId}`} className="flex items-start gap-2 px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                <span className="text-[9px] text-indigo-600 font-bold leading-tight w-11 shrink-0 truncate mt-0.5" title={a.property}>{a.property}</span>
                <span className="text-[10px] text-slate-800 flex-1 min-w-0 truncate mt-0.5">{a.question}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
              </Link>
            ))
          )}
        </div>

        {/* AI replied — review how the assistant is answering (esp. at launch) */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <Bot className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-semibold text-slate-900">AI replied</span>
            <span className="text-[10px] text-slate-400">recent — tap to review</span>
          </div>
          {d.aiReplied.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No AI replies yet.</p>
          ) : (
            d.aiReplied.map((a, i) => (
              <Link key={i} href={`/reservations/${a.reservationId}`} className="flex items-start gap-2 px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                <span className="text-[9px] text-indigo-600 font-bold leading-tight w-11 shrink-0 truncate mt-0.5" title={a.property}>{a.property}</span>
                <div className="flex-1 min-w-0">
                  {a.question && (
                    <p className="text-[10px] text-slate-500 truncate leading-snug">
                      <span className="font-bold text-slate-400">Q</span> {a.question}
                    </p>
                  )}
                  <p className="text-[10.5px] text-slate-800 line-clamp-2 leading-snug">
                    <span className="font-bold text-indigo-400">A</span> {a.reply}
                  </p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
              </Link>
            ))
          )}
        </div>
      </div>

      {/* ⑦ open tasks */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <ListChecks className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-900">Open tasks</span>
          {d.tasks.length > 0 && <span className="ml-auto text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">{d.tasks.length}</span>}
        </div>
        <OpenTasks initial={d.tasks} />
      </div>

      {/* ⑧ gap occupancy */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <CalendarRange className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-900">Gap occupancy — next {HORIZON} nights</span>
          <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> booked</span>
            <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> open</span>
          </span>
        </div>
        {d.occupancy.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No properties yet.</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {d.occupancy.map((p) => (
              <Link key={p.id} href="/calendar" className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                <span className="text-[12px] font-semibold text-slate-800 flex-1 min-w-0 truncate">
                  {p.name} <span className="text-slate-400 font-normal">· {p.city}</span>
                </span>
                <span className="flex gap-[3px] shrink-0">
                  {p.states.map((s, i) => (
                    <i key={i} className={`w-[15px] h-[15px] rounded-[4px] inline-block ${s === "b" ? "bg-emerald-500" : s === "x" ? "bg-slate-300" : "bg-rose-500"}`} title={s === "b" ? "Booked" : s === "x" ? "Blocked" : "Open"} />
                  ))}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ⑨ existing reservations (kept, below everything) */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-900">Recent reservations</span>
          <Link href="/reservations" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Link>
        </div>
        {d.recentReservations.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No reservations yet</p>
        ) : (
          d.recentReservations.map((r) => (
            <Link key={r.id} href={`/reservations/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
              <span className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-xs shrink-0">{r.guest.name[0]?.toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-900 truncate">{r.guest.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{r.property.name} · {formatShortDate(r.checkIn)}–{formatShortDate(r.checkOut)}</p>
              </div>
              {r.totalAmount != null && <span className="text-[12.5px] font-semibold text-slate-700 tabular-nums shrink-0">{formatCurrency(r.totalAmount, r.currency)}</span>}
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${SOURCE_COLORS[r.source] || "bg-slate-100 text-slate-600"}`}>{SOURCE_LABELS[r.source] || r.source}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
