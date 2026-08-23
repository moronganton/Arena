"use client";
import { useState, useEffect, useCallback } from "react";
import { Check, Save, RefreshCw, AlertTriangle } from "lucide-react";

interface PropertyTaxFields {
  id: string;
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
// wire values confirmed live (see lib/channels/channex-taxes.ts).
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

// Rate + logic/type/nights + the auto-charge toggle, for one property. Moved
// here from the old standalone City Tax settings panel - this is
// property-scoped configuration, so it belongs alongside everything else
// about the property rather than behind a separate picker on another page.
// City Tax itself stays a pure report (who's paid, who hasn't).
export default function CityTaxSettingsPanel({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<PropertyTaxFields | null>(null);
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

  function apply(p: PropertyTaxFields) {
    setProperty(p);
    setRate(p.cityTaxPerNight != null ? String(p.cityTaxPerNight) : "");
    setAutoCharge(p.cityTaxAutoChargeEnabled);
    setTitle(p.cityTaxTitle ?? "City tax");
    setIsInclusive(p.cityTaxIsInclusive ?? false);
    setLogic(p.cityTaxLogic ?? "per_person_per_night");
    setType(p.cityTaxType ?? "city_tax");
    setMaxNights(p.cityTaxMaxNights != null ? String(p.cityTaxMaxNights) : "");
    setSkipNights(p.cityTaxSkipNights != null ? String(p.cityTaxSkipNights) : "");
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/properties/${propertyId}`);
    if (res.ok) apply(await res.json());
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
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
      if (res.ok) apply(data);
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

  if (loading || !property) return <p className="text-sm text-slate-400">Loading&hellip;</p>;

  const configured = property.cityTaxPerNight != null;
  const needsSync = configured && property.channelProvider === "CHANNEX" && !property.cityTaxChannexId;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      {/* Always-visible record, so it's never ambiguous whether something is
          configured - a bare form with no persisted view left "did that
          actually stick?" unanswered until every field was re-checked. */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
        <div>
          {configured ? (
            <p className="text-sm text-slate-700">
              <span className="font-medium">{property.cityTaxTitle || "City tax"}</span> — {property.cityTaxPerNight} {property.currency} ({logicLabel(property.cityTaxLogic)})
              {property.cityTaxMaxNights ? ` · max ${property.cityTaxMaxNights} nights` : ""}
            </p>
          ) : (
            <p className="text-sm text-slate-400">Not set up yet</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {configured && property.cityTaxAutoChargeEnabled && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Auto-charge</span>
          )}
          {property.channelProvider === "CHANNEX" && configured && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${needsSync ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              {needsSync ? "Not yet synced" : "Synced to Channex"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
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
              Rate ({property.currency})
            </label>
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 3.50"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {property.channelProvider === "CHANNEX"
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
            disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
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
    </div>
  );
}
