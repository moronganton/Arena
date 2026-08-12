import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatShortDate, formatCurrency, SOURCE_COLORS, SOURCE_LABELS, STATUS_COLORS } from "@/lib/utils";
import { Plus, ArrowRight, Upload } from "lucide-react";
import { ReservationsSearchBar, ReservationsFilterMenu } from "@/components/reservations/ReservationsFilters";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; propertyId?: string; q?: string; sort?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  const where: Record<string, unknown> = {
    property: { ownerId: session!.user.id },
  };
  if (params.status) where.status = params.status;
  if (params.source) where.source = params.source;
  if (params.propertyId) where.propertyId = params.propertyId;
  if (params.q) {
    where.OR = [
      { guest: { name: { contains: params.q } } },
      { confirmationCode: { contains: params.q } },
    ];
  }

  const SORT_OPTIONS: Record<string, { field: "checkIn" | "createdAt"; dir: "asc" | "desc" }> = {
    checkin: { field: "checkIn", dir: "asc" },
    newest: { field: "createdAt", dir: "desc" },
    oldest: { field: "createdAt", dir: "asc" },
  };
  const sort = SORT_OPTIONS[params.sort || "newest"] || SORT_OPTIONS.newest;

  const [reservations, properties] = await Promise.all([
    prisma.reservation.findMany({
      where,
      include: {
        guest: true,
        property: { select: { id: true, name: true, city: true, country: true } },
        messages: { where: { isRead: false, direction: "INBOUND" }, select: { id: true } },
        accessCodes: { where: { isActive: true }, select: { code: true }, take: 1 },
      },
      orderBy: { [sort.field]: sort.dir },
    }),
    prisma.property.findMany({
      where: { ownerId: session!.user.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="text-slate-500 text-sm mt-0.5">{reservations.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reservations/import"
            title="Bulk import historical reservations from CSV"
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Bulk Import</span>
          </Link>
          <ReservationsFilterMenu
            properties={properties}
            initial={{
              q: params.q || "",
              propertyId: params.propertyId || "",
              status: params.status || "",
              source: params.source || "",
              sort: params.sort || "newest",
            }}
          />
          <Link
            href="/reservations/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Reservation</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>
      </div>

      <div className="mb-6">
        <ReservationsSearchBar
          initial={{
            q: params.q || "",
            propertyId: params.propertyId || "",
            status: params.status || "",
            source: params.source || "",
            sort: params.sort || "newest",
          }}
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {reservations.length === 0 && (
          <div className="text-center text-slate-400 py-12 bg-white rounded-2xl border border-slate-100">
            No reservations found
          </div>
        )}
        {reservations.map((r) => (
          <Link key={r.id} href={`/reservations/${r.id}`} className="block bg-white rounded-2xl border border-slate-100 p-4 hover:shadow-sm transition">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-sm flex-shrink-0">
                  {r.guest.name[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{r.guest.name}</p>
                  <p className="text-xs text-slate-500">{r.property.name}</p>
                </div>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[r.status] || "bg-slate-100 text-slate-600"}`}>
                {r.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Booked {formatShortDate(r.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{formatShortDate(r.checkIn)} → {formatShortDate(r.checkOut)}</span>
              <div className="flex items-center gap-2">
                <span className={`font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[r.source] || "bg-slate-100 text-slate-600"}`}>
                  {SOURCE_LABELS[r.source] || r.source}
                </span>
                {r.totalAmount && (
                  <span className="font-semibold text-slate-900">{formatCurrency(r.totalAmount, r.currency)}</span>
                )}
              </div>
            </div>
            {r.messages.length > 0 && (
              <div className="mt-2">
                <span className="text-xs bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">
                  {r.messages.length} unread message{r.messages.length > 1 ? "s" : ""}
                </span>
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Guest</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Property</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Dates</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Booked</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Channel</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Amount</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-4">Status</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-12">
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
                  <p className="text-sm text-slate-700">{formatShortDate(r.createdAt)}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
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
