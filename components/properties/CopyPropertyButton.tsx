"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, X } from "lucide-react";

// Duplicate-property control. Lives outside the card's <Link> so a click here
// never navigates to the property it is copying.
export default function CopyPropertyButton({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [include, setInclude] = useState({
    knowledge: true,
    checklist: true,
    pricing: true,
    templates: false,
    costRules: false,
  });

  const GROUPS: { key: keyof typeof include; label: string; hint: string }[] = [
    { key: "knowledge", label: "Knowledge base", hint: "Every entry, ready to edit. Values still describe the old property." },
    { key: "checklist", label: "Cleaning checklist", hint: "Reusable as-is." },
    { key: "pricing", label: "Pricing rules", hint: "Weekend, seasonal and minimum-stay rules." },
    { key: "templates", label: "Message templates", hint: "Copied paused, so nothing sends before you review it." },
    { key: "costRules", label: "Cost rules", hint: "Recurring and per-reservation costs. Only if the new property really has them." },
  ];

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/properties/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: propertyId, include }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to copy property"); return; }
      setOpen(false);
      router.refresh();
      router.push(`/properties/${data.property.id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        title="Duplicate this property"
        className="absolute top-3 right-3 z-10 bg-white/90 hover:bg-white text-slate-600 hover:text-indigo-600 rounded-lg p-2 shadow-sm transition"
      >
        <Copy className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="font-semibold text-slate-900">Duplicate property</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Creates <span className="font-medium text-slate-700">{propertyName} (copy)</span> with the
              same details. Choose what setup comes with it:
            </p>

            <div className="space-y-1.5 mb-4">
              {GROUPS.map((g) => (
                <label
                  key={g.key}
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={include[g.key]}
                    onChange={() => setInclude((p) => ({ ...p, [g.key]: !p[g.key] }))}
                    className="w-4 h-4 mt-0.5 rounded accent-indigo-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800">{g.label}</span>
                    <span className="block text-xs text-slate-500">{g.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 mb-4 space-y-2">
              <p>
                <span className="font-medium text-slate-700">Never copied:</span> smart locks, channel
                connections, reservations, cleaning history, expenses and calendar blocks.
              </p>
              <p>
                Channel connections in particular are left out on purpose - copying one would point two
                StayHQ properties at the same Booking.com listing, importing every reservation twice.
                Connect the new property to its own listing and lock afterwards.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={busy}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                Duplicate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
