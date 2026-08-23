"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Landmark, Check, Clock, X, AlertTriangle, Settings, Save, RefreshCw, Info } from "lucide-react";

interface PropertyLite {
  id: string;
  name: string;
  currency: string;
  channelProvider: string;
  cityTaxPerNight: number | null;
  cityTaxAutoChargeEnabled: boolean;
  cityTaxTitle: string;
  cityTaxIsInclusive: boolean;
  cityTaxLogic: string;
  cityTaxType: string;
  cityTaxMaxNights: number | null;
  cityTaxSkipNights: number | null;
  cityTaxChannexId: string | null;
}

// Mirrors Channex's own "Logic" and "Type" dropdowns on the Edit tax form -
// wire values confirmed live (see lib/channels/channex-taxes.ts), labels
// copied from the screenshots of that form so the two stay recognizable as
// the same setting.
const LOGIC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "percent", label: "Percent" },
  { value: "per_booking", label: "Per booking" },
  { value: "per_room", label: "Per room" },
  { value: "per_night", label: "Per night" },
  { value: "per_person", label: "Per person" },
  { value: "per_room_per_night", label: "Per room per night" },
  { value: "per_person_per_night", label: "Per person per night" },
];

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "tax", label: "Tax" },
  { value: "city_tax", label: "City tax" },
  { value: "fee", label: "Fee" },
];

function logicLabel(value: string): string {
  return LOGIC_OPTIONS.find((o) => o.value === value)?.label.toLowerCase() ?? value;
}

interface Charge {
  id: string;
  amountCents: number;
  currency: string;
  nights: number;
  guests: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  reservation: {
    id: string;
    checkIn: string;
    checkOut: string;
    guest: { name: string };
    property: { name: string };
  };
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  PAID: { label: "Paid", cls: "bg-emerald-100 text-emerald-700", icon: Check },
  PENDING: { label: "Pending", cls: "bg-amber-100 text-amber-700", icon: Clock },
  CANCELED: { label: "Canceled", cls: "bg-slate-100 text-slate-500", icon: X },
  // An auto-charge attempt that failed (e.g. the bank needed the guest
  // present to re-authenticate) - deliberately distinct from PENDING, which
  // means "a link is out, still waiting on the guest." This means "needs a
  // host to look at it," not "still in progress."
  FAILED: { label: "Needs attention", cls: "bg-rose-100 text-rose-700", icon: AlertTriangle },
  // Auto-charge deliberately held back because a Channex payment already
  // exists on this booking - not a failure, a "please check this by hand"
  // flag so the guest is never charged city tax twice.
  SKIPPED: { label: "Check Channex charges", cls: "bg-blue-100 text-blue-700", icon: Info },
};

// The "always see who paid or not, so I can follow up" view the manual bank
// transfer process couldn't provide - every city tax link ever sent, across
// every property, newest first.
export default function CityTaxPage() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/city-tax")
      .then((r) => r.json())
      .then((d) => setCharges(d.charges ?? []))
      .finally(() => setLoading(false));
  }, []);

  const pending = charges.filter((c) => c.status === "PENDING");
  const paidTotal = charges.filter((c) => c.status === "PAID").reduce((sum, c) => sum + c.amountCents, 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Landmark className="w-6 h-6 text-slate-400" />
          City tax
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every payment link sent, and whether the guest has actually paid.
        </p>
      </div>

      <PropertySettingsPanel />

      {!loading && charges.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500">Awaiting payment</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{pending.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500">Collected</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {money(paidTotal, charges[0]?.currency || "EUR")}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-6">Loading&hellip;</p>
        ) : charges.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">No city tax charges yet.</p>
            <p className="text-xs mt-1">Send a link from a reservation&apos;s Payments card once a property has a rate set.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {charges.map((c) => {
              const status = STATUS_STYLE[c.status] ?? STATUS_STYLE.PENDING;
              const Icon = status.icon;
              return (
                <Link
                  key={c.id}
                  href={`/reservations/${c.reservation.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{c.reservation.guest.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.reservation.property.name} &middot; {c.nights} night(s) &middot; {c.guests} guest(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-slate-900">{money(c.amountCents, c.currency)}</span>
                    <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${status.cls}`}>
                      <Icon className="w-3 h-3" />
                      {status.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Per-property rate + the auto-charge toggle. Lives here rather than the
// property edit page since both existing city-tax controls (rate, and now
// this) are specific to this feature, not general property fields.
function PropertySettingsPanel() {
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [rate, setRate] = useState("");
  const [autoCharge, setAutoCharge] = useState(false);
  const [title, setTitle] = useState("City tax");
  const [isInclusive, setIsInclusive] = useState(false);
  const [logic, setLogic] = useState("per_person_per_night");
  const [type, setType] = useState("city_tax");
  const [maxNights, setMaxNights] = useState("");
  const [skipNights, setSkipNights] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/properties");
    const data: PropertyLite[] = res.ok ? await res.json() : [];
    setProperties(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    load().then((data) => {
      if (data.length > 0) selectProperty(data[0]);
    });
  }, [load]);

  function selectProperty(p: PropertyLite) {
    setPropertyId(p.id);
    setRate(p.cityTaxPerNight != null ? String(p.cityTaxPerNight) : "");
    setAutoCharge(p.cityTaxAutoChargeEnabled);
    setTitle(p.cityTaxTitle ?? "City tax");
    setIsInclusive(p.cityTaxIsInclusive ?? false);
    setLogic(p.cityTaxLogic ?? "per_person_per_night");
    setType(p.cityTaxType ?? "city_tax");
    setMaxNights(p.cityTaxMaxNights != null ? String(p.cityTaxMaxNights) : "");
    setSkipNights(p.cityTaxSkipNights != null ? String(p.cityTaxSkipNights) : "");
  }

  function onPick(id: string) {
    const p = properties.find((x) => x.id === id);
    if (p) selectProperty(p);
  }

  const selected = properties.find((p) => p.id === propertyId);

  async function save() {
    if (!propertyId) return;
    setSaving(true);
    setSyncError(null);
    try {
      const parsedRate = rate.trim() === "" ? null : Number(rate);
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityTaxPerNight: parsedRate,
          cityTaxAutoChargeEnabled: autoCharge,
          cityTaxTitle: title.trim() === "" ? "City tax" : title.trim(),
          cityTaxIsInclusive: isInclusive,
          cityTaxLogic: logic,
          cityTaxType: type,
          cityTaxMaxNights: maxNights.trim() === "" ? null : Number(maxNights),
          cityTaxSkipNights: skipNights.trim() === "" ? null : Number(skipNights),
        }),
      });
      const data = await res.json();
      await load();
      if (data?.channexTaxSyncError) {
        setSyncError(data.channexTaxSyncError);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (properties.length === 0) return null;

  function editProperty(p: PropertyLite) {
    selectProperty(p);
    setExpanded(true);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
        <Settings className="w-4 h-4 text-slate-400" />
        Rate &amp; automation settings
      </span>

      {/* Always-visible record per property, so it's never ambiguous whether
          something is configured - saving used to just update a form with no
          persisted view of its own, which left "did that actually stick?"
          unanswered until you re-opened the form and checked every field. */}
      <div className="divide-y divide-slate-50 border-y border-slate-100 -mx-1">
        {properties.map((p) => {
          const configured = p.cityTaxPerNight != null;
          const needsSync = configured && p.channelProvider === "CHANNEX" && !p.cityTaxChannexId;
          return (
            <button
              key={p.id}
              onClick={() => editProperty(p)}
              className="w-full flex items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                {configured ? (
                  <p className="text-xs text-slate-500 truncate">
                    {p.cityTaxTitle || "City tax"} — {p.cityTaxPerNight} {p.currency} ({logicLabel(p.cityTaxLogic)})
                    {p.cityTaxMaxNights ? ` · max ${p.cityTaxMaxNights} nights` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">Not set up</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {configured && p.cityTaxAutoChargeEnabled && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Auto-charge</span>
                )}
                {p.channelProvider === "CHANNEX" && (
                  configured ? (
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${needsSync ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                    >
                      {needsSync ? "Not yet synced" : "Synced to Channex"}
                    </span>
                  ) : null
                )}
              </div>
            </button>
          );
        })}
      </div>

      {expanded && selected && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Editing</label>
            <select
              value={propertyId}
              onChange={(e) => onPick(e.target.value)}
              className="w-full sm:w-auto border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="City tax"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Shown to the guest on the payment link and, for Channex properties, on the listing itself.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Rate ({selected?.currency || "EUR"})
              </label>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 3.50"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                {selected?.channelProvider === "CHANNEX"
                  ? "Blank = no tax. Also pushed to Channex, so Booking.com/Airbnb disclose it to the guest."
                  : "Blank = no tax for this property. Smoobu-managed - StayHQ's own charge only, nothing pushed to a channel."}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Logic</label>
              <select
                value={logic}
                onChange={(e) => setLogic(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {LOGIC_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">How the rate above is multiplied out.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">How Channex categorizes it to OTAs. Also the key used to adopt an existing Channex tax on first sync.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max nights</label>
              <input
                value={maxNights}
                onChange={(e) => setMaxNights(e.target.value)}
                inputMode="numeric"
                placeholder="No limit"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Stop accruing after this many nights of a stay.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Skip nights</label>
              <input
                value={skipNights}
                onChange={(e) => setSkipNights(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Don&apos;t charge for this many nights at the start of a stay.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Inclusive of room rate</label>
              <button
                onClick={() => setIsInclusive((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isInclusive ? "bg-indigo-600" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isInclusive ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <p className="text-[11px] text-slate-400 mt-1">
                {isInclusive ? "On - already baked into the room rate shown to the guest." : "Off - added on top of the room rate."}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Auto-charge</label>
              <button
                onClick={() => setAutoCharge((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoCharge ? "bg-indigo-600" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoCharge ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <p className="text-[11px] text-slate-400 mt-1">
                {autoCharge
                  ? "On - a template with [City Tax Card Link] sends a real link, and any saved card gets auto-charged the quoted amount."
                  : "Off - everything stays manual. \"Send card link\" and \"Charge\" on a reservation still work by hand."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={saving || !propertyId}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2 rounded-xl transition"
            >
              Close
            </button>
            {saved && <span className="text-emerald-600 text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
          </div>
          {syncError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Saved in StayHQ, but couldn&apos;t reach Channex to update it there: {syncError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
