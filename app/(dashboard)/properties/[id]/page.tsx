import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Bed, Bath, Users, DollarSign, Wifi, Key, BookOpen } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import PropertyActions from "./PropertyActions";

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, ownerId: session!.user.id },
    include: {
      channels: true,
      locks: { include: { _count: { select: { accessCodes: true } } } },
      pricingRules: { where: { active: true }, orderBy: { priority: "desc" } },
      _count: {
        select: {
          reservations: { where: { status: { not: "CANCELLED" } } },
        },
      },
    },
  });

  if (!property) notFound();

  const upcomingReservations = await prisma.reservation.findMany({
    where: {
      propertyId: id,
      checkIn: { gte: new Date() },
      status: { not: "CANCELLED" },
    },
    include: { guest: true },
    orderBy: { checkIn: "asc" },
    take: 5,
  });

  const CHANNEL_INFO: Record<string, { color: string; label: string }> = {
    BOOKING: { color: "bg-blue-100 text-blue-700", label: "Booking.com" },
    AIRBNB: { color: "bg-rose-100 text-rose-700", label: "Airbnb" },
    VRBO: { color: "bg-green-100 text-green-700", label: "VRBO" },
    EXPEDIA: { color: "bg-yellow-100 text-yellow-700", label: "Expedia" },
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <Link href="/properties" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Properties
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {property.imageUrl ? (
              <img src={property.imageUrl} alt={property.name} className="w-full h-56 object-cover" />
            ) : (
              <div className="w-full h-56 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <span className="text-white text-5xl font-bold">{property.name[0]}</span>
              </div>
            )}
            <div className="p-6">
              <div className="flex items-start justify-between mb-2">
                <h1 className="text-2xl font-bold text-slate-900">{property.name}</h1>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${property.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {property.active ? "Active" : "Inactive"}
                  </span>
                  <PropertyActions id={property.id} />
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-slate-500 text-sm mb-4">
                <MapPin className="w-4 h-4" />
                {property.address}, {property.city}, {property.country}
              </div>
              <div className="flex items-center gap-6 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><Bed className="w-4 h-4" /> {property.bedrooms} bedrooms</span>
                <span className="flex items-center gap-1.5"><Bath className="w-4 h-4" /> {property.bathrooms} bathrooms</span>
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {property.maxGuests} guests</span>
              </div>
              {property.description && (
                <p className="text-slate-600 text-sm mt-4">{property.description}</p>
              )}
            </div>
          </div>

          {/* Upcoming Reservations */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Upcoming Reservations</h3>
            {upcomingReservations.length === 0 ? (
              <p className="text-slate-400 text-sm">No upcoming reservations</p>
            ) : (
              <div className="space-y-3">
                {upcomingReservations.map((r) => (
                  <Link key={r.id} href={`/reservations/${r.id}`}>
                    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors">
                      <div>
                        <p className="font-medium text-sm text-slate-900">{r.guest.name}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(r.checkIn).toLocaleDateString()} — {new Date(r.checkOut).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.status === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                        {r.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Knowledge Base */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-slate-500" />
              Knowledge Base
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              WiFi, parking, house rules, local tips — the AI assistant answers guests from these facts.
            </p>
            <Link href={`/properties/${property.id}/knowledge`} className="text-sm text-indigo-600 hover:underline">
              Manage knowledge →
            </Link>
          </div>
          {/* Pricing */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-slate-500" />
              Pricing
            </h3>
            <p className="text-2xl font-bold text-slate-900 mb-1">
              {formatCurrency(property.basePrice, property.currency)}
              <span className="text-sm font-normal text-slate-500">/night</span>
            </p>
            <p className="text-xs text-slate-500 mb-3">Base rate · {property.currency}</p>
            {property.pricingRules.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">Active Rules</p>
                {property.pricingRules.map((rule) => (
                  <div key={rule.id} className="flex justify-between items-center text-sm">
                    <span className="text-slate-700">{rule.name}</span>
                    <span className="text-indigo-600 font-medium">
                      {rule.price ? formatCurrency(rule.price, property.currency) : `${rule.adjustment && rule.adjustment > 0 ? "+" : ""}${rule.adjustment}${rule.adjType === "PERCENT" ? "%" : ""}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link href={`/pricing?propertyId=${property.id}`} className="text-sm text-indigo-600 hover:underline mt-3 block">
              Manage pricing →
            </Link>
          </div>

          {/* Channels */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Wifi className="w-4 h-4 text-slate-500" />
              Connected Channels
            </h3>
            {property.channels.length === 0 ? (
              <div>
                <p className="text-slate-400 text-sm mb-3">No channels connected</p>
                <Link href="/settings/channels" className="text-sm text-indigo-600 hover:underline">
                  Connect a channel →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {property.channels.map((ch) => {
                  const info = CHANNEL_INFO[ch.channel];
                  return (
                    <div key={ch.id} className="flex items-center justify-between">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${info?.color || "bg-slate-100 text-slate-600"}`}>
                        {info?.label || ch.channel}
                      </span>
                      <span className={`text-xs ${ch.isActive ? "text-green-600" : "text-slate-400"}`}>
                        {ch.lastSyncAt ? `Synced ${new Date(ch.lastSyncAt).toLocaleDateString()}` : "Not synced"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Smart Locks */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Key className="w-4 h-4 text-slate-500" />
              Smart Locks
            </h3>
            {property.locks.length === 0 ? (
              <div>
                <p className="text-slate-400 text-sm mb-3">No locks configured</p>
                <Link href="/settings/locks" className="text-sm text-indigo-600 hover:underline">
                  Add a lock →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {property.locks.map((lock) => (
                  <div key={lock.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{lock.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${lock.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {lock.isActive ? "Active" : "Off"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
