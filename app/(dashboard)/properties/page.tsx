import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Plus, MapPin, Bed, Users, Wifi } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import CopyPropertyButton from "@/components/properties/CopyPropertyButton";
import { PropertiesFilters } from "@/components/properties/PropertiesFilters";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; status?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  const [properties, allProperties] = await Promise.all([
    prisma.property.findMany({
      where: {
        ownerId: session!.user.id,
        ...(params.city ? { city: params.city } : {}),
        ...(params.status === "active" ? { active: true } : params.status === "inactive" ? { active: false } : {}),
      },
      include: {
        channels: true,
        locks: true,
        _count: {
          select: {
            reservations: { where: { status: { not: "CANCELLED" } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Unfiltered, just for the city list in the filter menu - so the option
    // set doesn't shrink to only what's currently visible once a filter is applied.
    prisma.property.findMany({
      where: { ownerId: session!.user.id },
      select: { city: true },
    }),
  ]);
  const cities = Array.from(new Set(allProperties.map((p) => p.city))).sort();

  const CHANNEL_BADGES: Record<string, { color: string; label: string }> = {
    BOOKING: { color: "bg-blue-100 text-blue-700", label: "Booking.com" },
    AIRBNB: { color: "bg-rose-100 text-rose-700", label: "Airbnb" },
    VRBO: { color: "bg-green-100 text-green-700", label: "VRBO" },
    EXPEDIA: { color: "bg-yellow-100 text-yellow-700", label: "Expedia" },
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Properties</h1>
          <p className="text-slate-500 text-sm mt-0.5">{properties.length} properties</p>
        </div>
        <div className="flex items-center gap-2">
          <PropertiesFilters cities={cities} initial={{ city: params.city || "", status: params.status || "" }} />
          <Link
            href="/properties/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Add Property
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {properties.length === 0 && (
          <div className="col-span-3 text-center py-20">
            <p className="text-slate-400 mb-4">
              {params.city || params.status ? "No properties match these filters" : "No properties yet"}
            </p>
            <Link href="/properties/new" className="text-indigo-600 hover:underline text-sm font-medium">
              Add your first property
            </Link>
          </div>
        )}
        {properties.map((p) => (
          <div key={p.id} className="relative">
            <CopyPropertyButton propertyId={p.id} propertyName={p.name} />
            <Link href={`/properties/${p.id}`}>
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden hover:shadow-md transition-shadow">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="w-full h-44 object-cover" />
              ) : (
                <div className="w-full h-44 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white text-3xl font-bold">{p.name[0]}</span>
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-bold text-slate-900">{p.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {p.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
                  <MapPin className="w-3.5 h-3.5" />
                  {p.city}, {p.country}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-600 mb-4">
                  <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5" /> {p.bedrooms} bed</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {p.maxGuests} guests</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-semibold text-sm">
                    {formatCurrency(p.basePrice, p.currency)}<span className="font-normal text-slate-400">/night</span>
                  </span>
                  <span className="text-xs text-slate-500">{p._count.reservations} reservations</span>
                </div>

                {/* Connected channels */}
                {p.channels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-slate-100">
                    {p.channels.filter(c => c.isActive).map((ch) => {
                      const badge = CHANNEL_BADGES[ch.channel];
                      return badge ? (
                        <span key={ch.id} className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>
                          {badge.label}
                        </span>
                      ) : null;
                    })}
                    {p.locks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {p.locks.length} lock{p.locks.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
