"use client";
import { useState, useEffect } from "react";
import { Plus, Trash2, RefreshCw, Check, AlertCircle, Download } from "lucide-react";

interface Property {
  id: string;
  name: string;
}

interface ChannelConfig {
  id: string;
  channel: string;
  icalUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  listingId?: string;
  isActive: boolean;
  lastSyncAt?: string;
  property: { id: string; name: string };
}

const CHANNELS = [
  { id: "BOOKING", name: "Booking.com", color: "bg-blue-600", logo: "B" },
  { id: "AIRBNB", name: "Airbnb", color: "bg-rose-500", logo: "A" },
  { id: "VRBO", name: "VRBO", color: "bg-green-600", logo: "V" },
  { id: "EXPEDIA", name: "Expedia", color: "bg-yellow-500", logo: "E" },
];

export default function ChannelsPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ id: string; message: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({
    propertyId: "",
    channel: "BOOKING",
    icalUrl: "",
    listingId: "",
    apiKey: "",
    apiSecret: "",
  });

  async function loadData() {
    const [props, chans] = await Promise.all([
      fetch("/api/properties").then((r) => r.json()),
      fetch("/api/channels/sync").then((r) => r.json()),
    ]);
    setProperties(Array.isArray(props) ? props : []);
    setChannels(Array.isArray(chans) ? chans : []);
    if (props.length > 0) setForm((f) => ({ ...f, propertyId: props[0].id }));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function saveChannel() {
    const res = await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      await loadData();
    }
  }

  async function syncChannel(id: string) {
    setSyncing(id);
    await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: id }),
    });
    await loadData();
    setSyncing(null);
  }

  async function syncAll() {
    setSyncing("all");
    await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_all" }),
    });
    await loadData();
    setSyncing(null);
  }

  async function importReservations(channelId: string) {
    setImporting(channelId);
    setImportResult(null);
    const res = await fetch("/api/booking/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    const data = await res.json();
    if (res.ok) {
      setImportResult({
        id: channelId,
        message: `Imported ${data.imported} new, updated ${data.updated} reservations.${data.errors?.length ? ` (${data.errors.length} errors)` : ""}`,
        ok: true,
      });
      await loadData();
    } else {
      setImportResult({ id: channelId, message: data.error || "Import failed", ok: false });
    }
    setImporting(null);
  }

  async function deleteChannel(id: string) {
    await fetch(`/api/channels/sync?id=${id}`, { method: "DELETE" });
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  const selectedChannel = form.channel;
  const isBooking = selectedChannel === "BOOKING";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Channel Connections</h1>
          <p className="text-slate-500 text-sm mt-0.5">Connect your OTA listings via iCal or API</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={syncAll}
            disabled={syncing === "all"}
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing === "all" ? "animate-spin" : ""}`} />
            Sync All
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Add Channel
          </button>
        </div>
      </div>

      {/* Channel status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {CHANNELS.map((ch) => {
          const connected = channels.filter((c) => c.channel === ch.id && c.isActive);
          return (
            <div key={ch.id} className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-9 h-9 ${ch.color} rounded-xl flex items-center justify-center text-white font-bold text-sm`}>
                  {ch.logo}
                </div>
                <span className="font-medium text-slate-800 text-sm">{ch.name}</span>
              </div>
              {connected.length > 0 ? (
                <div className="flex items-center gap-1 text-green-600 text-xs">
                  <Check className="w-3.5 h-3.5" />
                  {connected.length} connected
                </div>
              ) : (
                <div className="flex items-center gap-1 text-slate-400 text-xs">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Not connected
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Channel Form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Connect Channel</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
              <select
                value={form.propertyId}
                onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Channel</label>
              <select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {isBooking ? (
              <>
                {/* Booking.com API credentials */}
                <div className="col-span-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                  <strong>Booking.com API Setup:</strong> You need a Connectivity Partner account.
                  Go to your Booking.com Extranet → <em>Account → API credentials</em> to get your
                  username and password. Your Hotel ID is the number in your Extranet URL.
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Username</label>
                  <input
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="Your Booking.com API username"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Password</label>
                  <input
                    type="password"
                    value={form.apiSecret}
                    onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
                    placeholder="Your Booking.com API password"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hotel ID</label>
                  <input
                    value={form.listingId}
                    onChange={(e) => setForm({ ...form, listingId: e.target.value })}
                    placeholder="e.g. 1234567"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">iCal URL <span className="text-slate-400 font-normal">(optional, for calendar sync)</span></label>
                  <input
                    value={form.icalUrl}
                    onChange={(e) => setForm({ ...form, icalUrl: e.target.value })}
                    placeholder="https://admin.booking.com/hotel/ical/..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            ) : (
              <>
                {/* iCal-only for other platforms */}
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                  <strong>iCal Sync Setup:</strong> Find your iCal export URL in each platform's calendar settings:
                  <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs">
                    <li><strong>Airbnb:</strong> Calendar → Export Calendar → Copy iCal link</li>
                    <li><strong>VRBO:</strong> Calendar → Import/Export → Export iCal</li>
                    <li><strong>Expedia:</strong> Calendar → Sync Calendar → iCal URL</li>
                  </ul>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">iCal URL</label>
                  <input
                    value={form.icalUrl}
                    onChange={(e) => setForm({ ...form, icalUrl: e.target.value })}
                    placeholder="https://www.airbnb.com/calendar/ical/..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Listing ID <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    value={form.listingId}
                    onChange={(e) => setForm({ ...form, listingId: e.target.value })}
                    placeholder="Your listing ID on the platform"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={saveChannel}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              Save & Connect
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connected Channels List */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {channels.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p>No channels connected yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {channels.map((ch) => {
              const info = CHANNELS.find((c) => c.id === ch.channel);
              const hasApiCredentials = ch.channel === "BOOKING" && ch.apiKey && ch.listingId;
              return (
                <div key={ch.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-9 h-9 flex-shrink-0 ${info?.color || "bg-slate-400"} rounded-xl flex items-center justify-center text-white font-bold text-sm`}>
                      {info?.logo || ch.channel[0]}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm text-slate-900">{info?.name || ch.channel}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ch.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {ch.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{ch.property.name}</p>
                      {ch.icalUrl && (
                        <p className="text-xs text-slate-400 font-mono truncate max-w-xs mt-0.5">{ch.icalUrl}</p>
                      )}
                      {hasApiCredentials && (
                        <p className="text-xs text-blue-600 mt-0.5">API connected · Hotel {ch.listingId}</p>
                      )}
                      {ch.lastSyncAt && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Last sync: {new Date(ch.lastSyncAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {hasApiCredentials && (
                        <button
                          onClick={() => importReservations(ch.id)}
                          disabled={importing === ch.id}
                          title="Import reservations from Booking.com API"
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition disabled:opacity-50"
                        >
                          <Download className={`w-3.5 h-3.5 ${importing === ch.id ? "animate-bounce" : ""}`} />
                          {importing === ch.id ? "Importing..." : "Import"}
                        </button>
                      )}
                      {ch.icalUrl && (
                        <button
                          onClick={() => syncChannel(ch.id)}
                          disabled={syncing === ch.id}
                          title="Sync iCal calendar"
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition disabled:opacity-50"
                        >
                          <RefreshCw className={`w-4 h-4 ${syncing === ch.id ? "animate-spin" : ""}`} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteChannel(ch.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Import result banner */}
                  {importResult?.id === ch.id && (
                    <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${importResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {importResult.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
