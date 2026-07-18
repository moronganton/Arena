"use client";
import { useState, useEffect, useCallback } from "react";
import { Link2, Unlink, RefreshCw, Download, Copy, Check } from "lucide-react";

interface SmoobuApartment {
  id: string;
  name: string;
}

interface StayhqProperty {
  id: string;
  name: string;
}

interface Mapping {
  propertyId: string;
  listingId: string | null;
}

export default function SmoobuPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const [smoobuApartments, setSmoobuApartments] = useState<SmoobuApartment[]>([]);
  const [stayhqProperties, setStayhqProperties] = useState<StayhqProperty[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loadingProps, setLoadingProps] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [mappingsSaved, setMappingsSaved] = useState(false);

  const [automation, setAutomation] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const loadProperties = useCallback(async () => {
    setLoadingProps(true);
    const res = await fetch("/api/smoobu/properties");
    const data = await res.json();
    if (res.ok) {
      setSmoobuApartments(data.smoobuApartments);
      setStayhqProperties(data.stayhqProperties);
      const map: Record<string, string> = {};
      for (const m of data.mappings as Mapping[]) {
        if (m.listingId) map[m.propertyId] = m.listingId;
      }
      setMappings(map);
    } else {
      setError(data.error || "Failed to load properties");
    }
    setLoadingProps(false);
  }, []);

  useEffect(() => {
    fetch("/api/smoobu/account")
      .then((r) => r.json())
      .then((d) => {
        setConnected(!!d.connected);
        setAutomation(!!d.automationEnabled);
        if (d.connected) loadProperties();
      });
  }, [loadProperties]);

  async function toggleAutomation(enabled: boolean) {
    setAutomation(enabled);
    await fetch("/api/smoobu/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automationEnabled: enabled }),
    });
  }

  async function connect() {
    setConnecting(true);
    setError("");
    const res = await fetch("/api/smoobu/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, label: tokenLabel }),
    });
    const data = await res.json();
    if (res.ok) {
      setConnected(true);
      setApiKey("");
      await loadProperties();
    } else {
      setError(data.error || "Connection failed");
    }
    setConnecting(false);
  }

  async function disconnect() {
    if (!confirm("Disconnect Smoobu? Bookings will no longer sync automatically.")) return;
    await fetch("/api/smoobu/account", { method: "DELETE" });
    setConnected(false);
    setSmoobuApartments([]);
  }

  async function saveMappings() {
    setSavingMappings(true);
    setMappingsSaved(false);
    const payload = stayhqProperties.map((p) => ({
      propertyId: p.id,
      smoobuApartmentId: mappings[p.id] || "",
    }));
    const res = await fetch("/api/smoobu/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: payload }),
    });
    setSavingMappings(false);
    if (res.ok) {
      setMappingsSaved(true);
      setTimeout(() => setMappingsSaved(false), 3000);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult("");
    const res = await fetch("/api/smoobu/sync", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setSyncResult(
        `Imported ${data.imported} new, updated ${data.updated}, cancelled ${data.cancelled} reservation(s).` +
        (data.errors?.length ? ` ${data.errors.length} error(s): ${data.errors[0]}` : "")
      );
    } else {
      setSyncResult(`Error: ${data.error}`);
    }
    setSyncing(false);
  }

  function copyWebhookUrl() {
    const url = `${window.location.origin}/api/smoobu/webhook?secret=YOUR_WEBHOOK_SECRET`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Smoobu Channel Manager</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Sync reservations from Booking.com and Airbnb automatically via Smoobu
        </p>
      </div>

      {/* Connection card */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Link2 className="w-4 h-4 text-slate-500" />
          Smoobu Account
        </h3>

        {connected === null ? (
          <p className="text-sm text-slate-400 mt-3">Loading...</p>
        ) : connected ? (
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-slate-700">Connected to Smoobu</span>
            </div>
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition"
            >
              <Unlink className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-slate-500 mb-4">
              In Smoobu go to <strong>Settings → For Developers</strong> and create/copy your API
              credentials. Paste the <strong>Secret</strong> below; if Smoobu also gave you a{" "}
              <strong>Label</strong> (e.g. usr_live_...), paste that too — StayHQ will figure out
              the right combination automatically.
            </p>
            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-700">{error}</div>
            )}
            <div className="space-y-3">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Secret / API key (required)"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={tokenLabel}
                onChange={(e) => setTokenLabel(e.target.value)}
                placeholder="Label (optional — e.g. usr_live_...)"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={connect}
                disabled={connecting || !apiKey.trim()}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {connecting ? "Trying all auth methods..." : "Connect"}
              </button>
            </div>
          </div>
        )}
      </div>

      {connected && (
        <>
          {/* Property mapping */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
            <h3 className="font-semibold text-slate-900 mb-1">Property Mapping</h3>
            <p className="text-sm text-slate-500 mb-4">
              Match each StayHQ property to its Smoobu apartment so bookings land in the right place.
            </p>
            {loadingProps ? (
              <p className="text-sm text-slate-400">Loading apartments from Smoobu...</p>
            ) : (
              <>
                <div className="space-y-3">
                  {stayhqProperties.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 text-sm">
                      <span className="font-medium text-slate-800 flex-1">{p.name}</span>
                      <span className="text-slate-400">→</span>
                      <select
                        value={mappings[p.id] || ""}
                        onChange={(e) => setMappings({ ...mappings, [p.id]: e.target.value })}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Not mapped</option>
                        {smoobuApartments.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <button
                  onClick={saveMappings}
                  disabled={savingMappings}
                  className="mt-4 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {mappingsSaved ? <Check className="w-4 h-4" /> : null}
                  {savingMappings ? "Saving..." : mappingsSaved ? "Saved!" : "Save Mapping"}
                </button>
              </>
            )}
          </div>

          {/* Sync */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
            <h3 className="font-semibold text-slate-900 mb-1">Import Reservations</h3>
            <p className="text-sm text-slate-500 mb-4">
              Pulls all bookings (arrivals in the last 90 days and future) from Smoobu.
            </p>

            {/* Automation toggle */}
            <div className={`flex items-start gap-3 rounded-xl border p-3 mb-4 ${automation ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
              <label className="relative inline-flex items-center cursor-pointer mt-0.5">
                <input
                  type="checkbox"
                  checked={automation}
                  onChange={(e) => toggleAutomation(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
              </label>
              <div className="text-sm">
                <p className="font-medium text-slate-800">
                  PIN codes &amp; guest emails: {automation ? "ON" : "OFF (testing mode)"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {automation
                    ? "Imported confirmed bookings will push a PIN to your smart lock and email the guest."
                    : "Imported bookings only create reservations in StayHQ — no lock codes, no guest emails. Turn on when you go live."}
                </p>
              </div>
            </div>

            <button
              onClick={syncNow}
              disabled={syncing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              <Download className={`w-4 h-4 ${syncing ? "animate-bounce" : ""}`} />
              {syncing ? "Importing..." : "Import Now"}
            </button>
            {syncResult && (
              <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${syncResult.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                {syncResult}
              </div>
            )}
          </div>

          {/* Webhook setup */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Real-Time Sync (Webhook)</h3>
            <p className="text-sm text-slate-500 mb-3">
              For instant updates, in Smoobu go to <strong>Settings → For Developers → Webhook</strong>{" "}
              and set the URL below. Replace{" "}
              <code className="bg-slate-100 px-1 rounded">YOUR_WEBHOOK_SECRET</code> with the value of
              the <code className="bg-slate-100 px-1 rounded">WEBHOOK_SECRET</code> variable in Railway
              (same one used for Beds24).
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-100 text-slate-700 text-xs px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">
                {typeof window !== "undefined" ? window.location.origin : ""}/api/smoobu/webhook?secret=YOUR_WEBHOOK_SECRET
              </code>
              <button
                onClick={copyWebhookUrl}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                title="Copy"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
