import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatShortDate, formatCurrency, SOURCE_COLORS, SOURCE_LABELS, STATUS_COLORS } from "@/lib/utils";
import { Plus, Search, Filter, ArrowRight } from "lucide-react";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; q?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  const where: Record<string, unknown> = {
    property: { ownerId: session!.user.id },
  };
  if (params.status) where.status = params.status;
  if (params.source) where.source = params.source;
  if (params.q) {
    where.OR = [
      { guest: { name: { contains: params.q } } },
      { confirmationCode: { contains: params.q } },
    ];
  }

  const reservations = await prisma.reservation.findMany({
    where,
    include: {
      guest: true,
      property: { select: { id: true, name: true, city: true, country: true } },
      messages: { where: { isRead: false, direction: "INBOUND" }, select: { id: true } },
      accessCodes: { where: { isActive: true }, select: { code: true }, take: 1 },
    },
    orderBy: { checkIn: "asc" },
  });

  const statuses = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];
  const sources = ["BOOKING", "AIRBNB", "VRBO", "EXPEDIA", "DIRECT"];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-slate-500 text-sm mt-0.5">{reservations.length} total</p>
        </div>
        <Link
          href="/reservations/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          New Reservation
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6 flex flex-wrap gap-3">
        <form className="flex items-center gap-2 flex-1 min-w-48">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Search guest or code..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            name="status"
            defaultValue={params.status || ""}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            name="source"
            defaultValue={params.source || ""}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Channels</option>
            {sources.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Filter
          </button>
        </form>
      </div>

      {/* Reservations Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Guest</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Property</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Dates</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Channel</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Amount</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Status</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-12">
                  No reservations found
                </td>
              </tr>
            )}
            {reservations.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-sm">
                      {r.guest.name[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{r.guest.name}</p>
                      {r.messages.length > 0 && (
                        <span className="text-xs bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full">
                          {r.messages.length} unread
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-700">{r.property.name}</p>
                  <p className="text-xs text-slate-500">{r.property.city}, {r.property.country}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-slate-700">{formatShortDate(r.checkIn)}</p>
                  <p className="text-xs text-slate-500">→ {formatShortDate(r.checkOut)}</p>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${SOURCE_COLORS[r.source] || "bg-slate-100 text-slate-600"}`}>
                    {SOURCE_LABELS[r.source] || r.source}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {r.totalAmount ? (
                    <p className="text-sm font-medium text-slate-900">{formatCurrency(r.totalAmount, r.currency)}</p>
                  ) : (
                    <p className="text-sm text-slate-400">—</p>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[r.status] || "bg-slate-100 text-slate-600"}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <Link href={`/reservations/${r.id}`} className="text-indigo-600 hover:text-indigo-800 transition">
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
