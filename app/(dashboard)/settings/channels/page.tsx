"use client";
import { useState, useEffect } from "react";
import { Plus, Trash2, RefreshCw, Check, AlertCircle, ExternalLink } from "lucide-react";

interface Property {
  id: string;
  name: string;
}

interface ChannelConfig {
  id: string;
  channel: string;
  icalUrl?: string;
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
  const [form, setForm] = useState({
    propertyId: "",
    channel: "BOOKING",
    icalUrl: "",
    listingId: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/properties").then((r) => r.json()),
      fetch("/api/channels/sync").then((r) => r.json()),
    ]).then(([props, chans]) => {
      setProperties(props);
      setChannels(chans);
      if (props.length > 0) setForm((f) => ({ ...f, propertyId: props[0].id }));
    });
  }, []);

  async function saveChannel() {
    const res = await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const config = await res.json();
      setChannels((prev) => {
        const existing = prev.findIndex((c) => c.id === config.id);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = config;
          return next;
        }
        return [...prev, config];
      });
      setShowForm(false);
    }
  }

  async function syncChannel(id: string) {
    setSyncing(id);
    await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: id }),
    });
    setSyncing(null);
    // Refresh
    const data = await fetch("/api/channels/sync").then((r) => r.json());
    setChannels(data);
  }

  async function syncAll() {
    setSyncing("all");
    await fetch("/api/channels/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_all" }),
    });
    setSyncing(null);
    const data = await fetch("/api/channels/sync").then((r) => r.json());
    setChannels(data);
  }

  async function deleteChannel(id: string) {
    await fetch(`/api/channels/sync?id=${id}`, { method: "DELETE" });
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

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

      {/* Available Channels Info */}
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

      {/* Add Form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Connect Channel</h3>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800">
            <strong>iCal Sync Setup:</strong> Find your iCal URL in each platform:
            <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs">
              <li><strong>Booking.com:</strong> Extranet → Calendar → Export Calendar</li>
              <li><strong>Airbnb:</strong> Calendar → Export Calendar → Copy iCal link</li>
              <li><strong>VRBO:</strong> Calendar → Import/Export → Export iCal</li>
              <li><strong>Expedia:</strong> Calendar → Sync Calendar → iCal URL</li>
            </ul>
          </div>

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
              <label className="block text-sm font-medium text-slate-700 mb-1">Listing ID (optional)</label>
              <input
                value={form.listingId}
                onChange={(e) => setForm({ ...form, listingId: e.target.value })}
                placeholder="Your listing ID on the platform"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
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

      {/* Connected Channels */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {channels.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p>No channels connected yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-4">Channel</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-4">Property</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-4">iCal URL</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-4">Last Sync</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-4">Status</th>
                <th className="px-5 py-4"></th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => {
                const info = CHANNELS.find((c) => c.id === ch.channel);
                return (
                  <tr key={ch.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 ${info?.color || "bg-slate-400"} rounded-lg flex items-center justify-center text-white font-bold text-xs`}>
                          {info?.logo || ch.channel[0]}
                        </div>
                        <span className="font-medium text-sm text-slate-900">{info?.name || ch.channel}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">{ch.property.name}</td>
                    <td className="px-5 py-4">
                      {ch.icalUrl ? (
                        <span className="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-1 rounded max-w-48 block truncate">
                          {ch.icalUrl}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {ch.lastSyncAt
                        ? new Date(ch.lastSyncAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ch.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {ch.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => syncChannel(ch.id)}
                          disabled={syncing === ch.id}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Sync now"
                        >
                          <RefreshCw className={`w-4 h-4 ${syncing === ch.id ? "animate-spin" : ""}`} />
                        </button>
                        <button
                          onClick={() => deleteChannel(ch.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
