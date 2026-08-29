"use client";
import { useState, useEffect } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import SmoobuSection from "@/components/channels/SmoobuSection";
import CalendarFeedsSection from "@/components/channels/CalendarFeedsSection";
import ChannexMappingFrame from "@/components/channels/ChannexMappingFrame";

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
  /** null when Channex could not be asked - rendered as silence, not as gone. */
  channexPropertyMissing?: boolean | null;
  /** Empty means asked and genuinely none; null means not asked. */
  connectedOtas?: string[] | null;
}

const OTA_LABEL: Record<string, string> = { BOOKING: "Booking.com", AIRBNB: "Airbnb" };

function ManagerBadge({ manager, missing }: { manager: string; missing?: boolean | null }) {
  if (manager === "CHANNEX") {
    // The badge used to read straight off channelProvider, so it went on
    // saying "Channex" for a property that had been removed there - the flag
    // is local and survives anything done on the Channex side.
    if (missing) {
      return (
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700 shrink-0">
          Not on Channex
        </span>
      );
    }
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
  // Per-property state for the "Force full resync" action - keyed by
  // propertyId so triggering one property's sync doesn't disturb another's.
  // taskIds is kept alongside the summary line because Channex's PMS
  // certification asks for the ids it returned as the evidence a push really
  // happened ("Provide IDs received from Channex. One ID per line."). The
  // count alone can't be pasted into that form, and reading them out of the
  // network tab is not something to be doing on a live screenshare.
  const [syncState, setSyncState] = useState<Record<string, { busy: boolean; result: string | null; taskIds: string[]; error: string | null }>>({});
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  // Which property's channel-mapping overlay is open, if any.
  const [mapping, setMapping] = useState<{ id: string; name: string } | null>(null);

  const load = () => {
    fetch("/api/channels/state")
      .then((r) => (r.ok ? r.json() : { properties: [] }))
      .then((d) => setProperties(d.properties ?? []))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function forceFullSync(propertyId: string) {
    setSyncState((s) => ({ ...s, [propertyId]: { busy: true, result: null, taskIds: [], error: null } }));
    try {
      const res = await fetch("/api/channex/full-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSyncState((s) => ({
        ...s,
        [propertyId]: {
          busy: false,
          result: `Pushed ${data.horizonDays} days · ${data.taskIds.length} update(s) accepted`,
          taskIds: data.taskIds ?? [],
          error: null,
        },
      }));
      load(); // refresh "last push" / queue counts
    } catch (err) {
      setSyncState((s) => ({ ...s, [propertyId]: { busy: false, result: null, taskIds: [], error: err instanceof Error ? err.message : "Sync failed" } }));
    }
  }

  function copyTaskIds(propertyId: string, ids: string[]) {
    // Newline-separated because that is the exact shape the certification
    // form asks to be pasted in - "One ID per line".
    navigator.clipboard.writeText(ids.join("\n")).then(() => {
      setCopiedFor(propertyId);
      setTimeout(() => setCopiedFor((c) => (c === propertyId ? null : c)), 2000);
    });
  }

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
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.connectedOtas?.map((o) => (
                      <span
                        key={o}
                        className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-600"
                      >
                        {OTA_LABEL[o] ?? o}
                      </span>
                    ))}
                    {p.connectedOtas?.length === 0 && !p.channexPropertyMissing && (
                      <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                        No OTA
                      </span>
                    )}
                    <ManagerBadge manager={p.manager} missing={p.channexPropertyMissing} />
                  </div>
                </div>
                {p.warning && (
                  <p className={`mt-1.5 text-xs rounded-lg px-2.5 py-1.5 border ${
                    p.channexPropertyMissing
                      ? "text-red-700 bg-red-50 border-red-200"
                      : "text-amber-700 bg-amber-50 border-amber-200"
                  }`}>
                    {p.warning}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Channel connection and room/rate mapping are embedded here (see
          ChannexMappingFrame) rather than sending the host to log in
          elsewhere - so this offers the real controls, not just a status
          readout. */}
      {channexProperties.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Connected channels</h2>
            <p className="text-slate-500 text-sm mt-0.5">
              Connect an OTA and map its rooms and rates to a property. Availability and prices then
              push automatically whenever they change here.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {channexProperties.map((p) => {
              const sync = syncState[p.id];
              return (
                <div key={p.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-800 min-w-0 truncate">{p.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`text-xs text-right ${
                          p.channexPropertyMissing
                            ? "text-red-600 font-medium"
                            : p.connectedOtas?.length === 0
                              ? "text-amber-700 font-medium"
                              : "text-slate-500"
                        }`}
                      >
                        {/* A last-push date is historically true and, once the
                            property is gone from Channex, completely
                            misleading - it reads as a working connection. */}
                        {p.channexPropertyMissing
                          ? "Not on Channex any more"
                          : p.connectedOtas?.length === 0
                          ? "No OTA connected"
                          : !p.channex
                          ? "Not provisioned"
                          : p.channex.lastPushAt
                          ? `Last push ${new Date(p.channex.lastPushAt).toLocaleDateString()}`
                          : "Not pushed yet"}
                        {p.channex && p.channex.pendingUpdates > 0 && ` \u00b7 ${p.channex.pendingUpdates} queued`}
                        {p.channex && p.channex.failedUpdates > 0 && (
                          <span className="text-red-600"> {"\u00b7"} {p.channex.failedUpdates} failed</span>
                        )}
                      </span>
                      {p.channex && (
                        <button
                          onClick={() => setMapping({ id: p.id, name: p.name })}
                          title="Connect an OTA and map its rooms and rates, without leaving StayHQ"
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-2.5 py-1.5 rounded-lg transition"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          Manage channels
                        </button>
                      )}
                      {p.channex && (
                        <button
                          onClick={() => forceFullSync(p.id)}
                          disabled={sync?.busy}
                          title="Push 500 days of availability, rates and restrictions - recovers from any gap without waiting for the next change"
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${sync?.busy ? "animate-spin" : ""}`} />
                          {sync?.busy ? "Syncing\u2026" : "Force full resync"}
                        </button>
                      )}
                    </div>
                  </div>
                  {sync?.result && (
                    <div className="mt-1.5 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1.5">
                      <p>{sync.result}</p>
                      {sync.taskIds.length > 0 && (
                        <>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-600">
                              Channex task IDs
                            </span>
                            <button
                              onClick={() => copyTaskIds(p.id, sync.taskIds)}
                              className="text-[11px] font-medium text-teal-700 hover:text-teal-900 underline underline-offset-2"
                            >
                              {copiedFor === p.id ? "Copied" : "Copy"}
                            </button>
                          </div>
                          <pre className="mt-1 font-mono text-[11px] leading-relaxed text-teal-800 whitespace-pre-wrap break-all">
                            {sync.taskIds.join("\n")}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                  {sync?.error && (
                    <p className="mt-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{sync.error}</p>
                  )}
                </div>
              );
            })}
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

      {/* Closing reloads the overview: a channel connected or unmapped in
          there changes what the rows above should say. */}
      {mapping && (
        <ChannexMappingFrame
          propertyId={mapping.id}
          propertyName={mapping.name}
          onClose={() => {
            setMapping(null);
            load();
          }}
        />
      )}
    </div>
  );
}
