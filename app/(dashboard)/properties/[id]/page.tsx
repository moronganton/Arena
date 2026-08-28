import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { getChannelState } from "@/lib/channels/channel-state";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Bed, Bath, Users } from "lucide-react";
import PropertyActions from "./PropertyActions";
import PropertyListingTabs from "@/components/properties/PropertyListingTabs";

// One full-width column. The right sidebar this page used to carry - pricing
// summary, channel manager, smart locks, knowledge base - squeezed the actual
// content into two thirds of the screen while duplicating what the tabs now
// own outright: the pricing card restated what the Rate plans tab shows, and
// the rest were cards standing in for the tabs they have since become. The
// header keeps identity and health; everything operable lives in the ribbon.
export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      locks: { select: { id: true, name: true, isActive: true } },
    },
  });

  if (!property) notFound();

  // Same source of truth the Channels settings page uses, so the two screens
  // can never disagree about who manages this property.
  const channels = (await getChannelState(property.ownerId, property.id))[0] ?? null;

  const [upcomingReservations, templates] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        propertyId: id,
        checkIn: { gte: new Date() },
        status: { not: "CANCELLED" },
      },
      include: { guest: true },
      orderBy: { checkIn: "asc" },
      take: 5,
    }),
    // Templates that reach this property's guests: scoped to it, or global.
    prisma.messageTemplate.findMany({
      where: { userId: session.user.id, OR: [{ propertyId: id }, { propertyId: null }] },
      orderBy: [{ propertyId: "desc" }, { name: "asc" }],
      select: { id: true, name: true, trigger: true, active: true, propertyId: true },
    }),
  ]);

  const isChannex = channels?.manager === "CHANNEX";

  // Everything the client tabs need, serialized (dates become ISO strings).
  const tabsData = {
    propertyId: property.id,
    propertyName: property.name,
    isChannex,
    calendarProperty: {
      id: property.id,
      name: property.name,
      currency: property.currency,
      channelProvider: property.channelProvider,
    },
    channels: channels
      ? {
          manager: channels.manager,
          warning: channels.warning,
          channexConnected: !!channels.channex,
          lastPushAt: channels.channex?.lastPushAt?.toISOString() ?? null,
          pendingUpdates: channels.channex?.pendingUpdates ?? 0,
          failedUpdates: channels.channex?.failedUpdates ?? 0,
          smoobuLastSyncAt: channels.smoobu?.lastSyncAt?.toISOString() ?? null,
          icalFeeds: channels.icalFeeds.map((f) => ({
            channel: f.channel,
            lastSyncAt: f.lastSyncAt?.toISOString() ?? null,
          })),
        }
      : null,
    locks: property.locks,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      trigger: t.trigger,
      active: t.active,
      scoped: t.propertyId !== null,
    })),
    description: property.description,
  };

  const syncLine = isChannex
    ? channels?.channex?.lastPushAt
      ? `Channex connected · last push ${new Date(channels.channex.lastPushAt).toLocaleDateString()}`
      : "Channex connected · not pushed yet"
    : channels?.manager === "SMOOBU"
      ? channels.smoobu?.lastSyncAt
        ? `Smoobu connected · synced ${new Date(channels.smoobu.lastSyncAt).toLocaleDateString()}`
        : "Smoobu connected · not synced yet"
      : null;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <Link href="/properties" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Properties
      </Link>

      {/* Header: identity and health only. The description is OTA-owned
          listing content like photos and facilities, so it lives with them
          under the Listing content tab rather than in the hero. */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 mb-6 flex gap-4 md:gap-5 items-start flex-wrap">
        {property.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={property.imageUrl}
            alt={property.name}
            className="w-36 h-24 md:w-44 md:h-28 rounded-xl object-cover shrink-0"
          />
        ) : (
          <div className="w-36 h-24 md:w-44 md:h-28 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
            <span className="text-white text-3xl font-bold">{property.name[0]}</span>
          </div>
        )}
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">{property.name}</h1>
            <span
              className={`text-xs px-2 py-1 rounded-full font-medium ${
                property.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {property.active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 text-sm mt-1.5">
            <MapPin className="w-4 h-4 shrink-0" />
            {property.address}, {property.city}, {property.country}
          </div>
          <div className="flex items-center gap-5 text-sm text-slate-600 mt-2.5 flex-wrap">
            <span className="flex items-center gap-1.5"><Bed className="w-4 h-4" /> {property.bedrooms} bedrooms</span>
            <span className="flex items-center gap-1.5"><Bath className="w-4 h-4" /> {property.bathrooms} bathrooms</span>
            <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {property.maxGuests} guests</span>
            {syncLine && (
              <span className="text-emerald-700 font-medium">{syncLine}</span>
            )}
          </div>
        </div>
        <PropertyActions id={property.id} />
      </div>

      <PropertyListingTabs data={tabsData} />

      {/* Upcoming Reservations */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mt-6">
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
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      r.status === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
