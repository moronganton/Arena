import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatShortDate, SOURCE_COLORS, SOURCE_LABELS, STATUS_COLORS } from "@/lib/utils";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  MessageSquare,
  TrendingUp,
  ArrowRight,
  Clock,
} from "lucide-react";

async function getDashboardData(userId: string) {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [properties, totalReservations, monthRevenue, upcomingCheckIns, activeGuests, unreadMessages, recentReservations] =
    await Promise.all([
      prisma.property.count({ where: { ownerId: userId, active: true } }),
      prisma.reservation.count({
        where: { property: { ownerId: userId }, status: { not: "CANCELLED" } },
      }),
      prisma.reservation.aggregate({
        where: {
          property: { ownerId: userId },
          status: { notIn: ["CANCELLED"] },
          checkIn: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { totalAmount: true },
      }),
      prisma.reservation.count({
        where: {
          property: { ownerId: userId },
          status: "CONFIRMED",
          checkIn: { gte: today, lte: next30 },
        },
      }),
      prisma.reservation.count({
        where: {
          property: { ownerId: userId },
          status: "CHECKED_IN",
        },
      }),
      prisma.message.count({
        where: {
          reservation: { property: { ownerId: userId } },
          isRead: false,
          direction: "INBOUND",
        },
      }),
      prisma.reservation.findMany({
        where: { property: { ownerId: userId }, status: { not: "CANCELLED" } },
        include: {
          guest: true,
          property: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  return {
    properties,
    totalReservations,
    monthRevenue: monthRevenue._sum.totalAmount || 0,
    upcomingCheckIns,
    activeGuests,
    unreadMessages,
    recentReservations,
  };
}

export default async function DashboardPage() {
  const session = await auth();
  const data = await getDashboardData(session!.user.id);

  const stats = [
    {
      label: "Properties",
      value: data.properties,
      icon: Building2,
      color: "bg-indigo-50 text-indigo-600",
      href: "/properties",
    },
    {
      label: "Revenue This Month",
      value: formatCurrency(data.monthRevenue),
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
      href: "/reservations",
    },
    {
      label: "Upcoming Check-ins",
      value: data.upcomingCheckIns,
      icon: CalendarDays,
      color: "bg-blue-50 text-blue-600",
      href: "/calendar",
    },
    {
      label: "Unread Messages",
      value: data.unreadMessages,
      icon: MessageSquare,
      color: "bg-rose-50 text-rose-600",
      href: "/messages",
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <div className="bg-white rounded-2xl border border-slate-100 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Reservations */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-slate-900">Recent Reservations</h2>
            <Link href="/reservations" className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="space-y-3">
            {data.recentReservations.length === 0 && (
              <p className="text-slate-400 text-sm py-4 text-center">No reservations yet</p>
            )}
            {data.recentReservations.map((r) => (
              <Link key={r.id} href={`/reservations/${r.id}`}>
                <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-sm flex-shrink-0">
                      {r.guest.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 text-sm truncate">{r.guest.name}</p>
                      <p className="text-xs text-slate-500 truncate">{r.property.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <div className="text-right">
                      <p className="text-sm text-slate-700">{formatShortDate(r.checkIn)} — {formatShortDate(r.checkOut)}</p>
                      {r.totalAmount && (
                        <p className="text-xs text-slate-500">{formatCurrency(r.totalAmount, r.currency)}</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${SOURCE_COLORS[r.source] || "bg-slate-100 text-slate-600"}`}>
                      {SOURCE_LABELS[r.source] || r.source}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link href="/reservations?new=true" className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition group">
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">New Reservation</span>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
              </Link>
              <Link href="/settings/channels" className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition group">
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">Sync Channels</span>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
              </Link>
              <Link href="/messages" className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition group">
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">
                  Check Messages
                  {data.unreadMessages > 0 && (
                    <span className="ml-2 bg-rose-500 text-white text-xs px-1.5 py-0.5 rounded-full">{data.unreadMessages}</span>
                  )}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
              </Link>
              <Link href="/calendar" className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition group">
                <span className="text-sm font-medium text-slate-700 group-hover:text-indigo-700">View Calendar</span>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
              </Link>
            </div>
          </div>

          <div className="bg-indigo-600 rounded-2xl p-6 text-white">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-indigo-300" />
              <span className="text-sm font-medium text-indigo-200">Active Guests</span>
            </div>
            <p className="text-4xl font-bold">{data.activeGuests}</p>
            <p className="text-indigo-300 text-sm mt-1">Currently checked in</p>
          </div>
        </div>
      </div>
    </div>
  );
}
