"use client";
import { useState, useEffect } from "react";
import SmoobuSection from "@/components/channels/SmoobuSection";
import CalendarFeedsSection from "@/components/channels/CalendarFeedsSection";

// One page for everything that connects a property to the outside world.
//
// This used to be two: a Channels page for per-OTA iCal feeds and a Smoobu
// page for the channel manager, with nothing at all for Channex. Nothing
// showed which manager owned which property, so a property could sit on
// Channex with live reservations while its page still advertised a channel
// manager abandoned months earlier.
//
// The order is deliberate: who manages what first, because that is the
// question being asked; then the per-manager detail; then calendar feeds
// last, since an iCal subscription is a different and lesser thing than the
// system that owns the listing.

interface PropertyChannelRow {
  id: string;
  name: string;
  manager: string;
  warning: string | null;
  channex: {
    lastPushAt: string | null;
    pendingUpdates: number;
    failedUpdates: number;
  } | null;
  smoobu: { apartmentId: string | null; lastSyncAt: string | null } | null;
}

function ManagerBadge({ manager }: { manager: string }) {
  if (manager === "CHANNEX") {
    return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal-100 text-teal-800 shrink-0">Channex</span>;
  }
  if (manager === "SMOOBU") {
    return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 shrink-0">Smoobu</span>;
  }
  return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0">Not connected</span>;
}

export default function ChannelsPage() {
  const [properties, setProperties] = useState<PropertyChannelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/channels/state")
      .then((r) => (r.ok ? r.json() : { properties: [] }))
      .then((d) => setProperties(d.properties ?? []))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  }, []);

  const channexProperties = properties.filter((p) => p.manager === "CHANNEX");

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Channels</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Which channel manager handles each property, and how each one is connected
        </p>
      </div>

      {/* A property is shown against exactly one manager. Two managers on the
          same listing is precisely what causes a double booking, so the
          overview surfaces that as a warning rather than listing both as if
          the arrangement were fine. */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Your properties</h3>
        {loading ? (
          <p className="text-sm text-slate-400">Loading&hellip;</p>
        ) : properties.length === 0 ? (
          <p className="text-sm text-slate-400">No properties yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {properties.map((p) => (
              <div key={p.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-800 min-w-0 truncate">{p.name}</span>
                  <ManagerBadge manager={p.manager} />
                </div>
                {p.warning && (
                  <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    {p.warning}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rooms and rates are mapped in the Channex dashboard, not here, so
          this reports the connection rather than offering controls that would
          not do anything. */}
      {channexProperties.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Channex</h2>
            <p className="text-slate-500 text-sm mt-0.5">
              Rooms and rates are mapped in the Channex dashboard. Availability and prices push
              automatically whenever they change here.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {channexProperties.map((p) => (
              <div key={p.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-800 min-w-0 truncate">{p.name}</span>
                <span className="text-xs text-slate-500 shrink-0 text-right">
                  {!p.channex
                    ? "Not provisioned"
                    : p.channex.lastPushAt
                    ? `Last push ${new Date(p.channex.lastPushAt).toLocaleDateString()}`
                    : "Not pushed yet"}
                  {p.channex && p.channex.pendingUpdates > 0 && ` \u00b7 ${p.channex.pendingUpdates} queued`}
                  {p.channex && p.channex.failedUpdates > 0 && (
                    <span className="text-red-600"> {"\u00b7"} {p.channex.failedUpdates} failed</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <SmoobuSection />
      </div>

      <div className="pt-2 border-t border-slate-200">
        <div className="mt-6 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Calendar feeds</h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Read-only iCal subscriptions. These sit alongside whichever manager owns a property, and
            only block dates - they never send prices or take bookings.
          </p>
        </div>
        <CalendarFeedsSection />
      </div>
    </div>
  );
}
