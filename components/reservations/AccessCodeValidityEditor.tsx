"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, RefreshCw, AlertTriangle, Check } from "lucide-react";

interface Props {
  accessCodeId: string;
  // CET wall-clock values ("YYYY-MM-DDTHH:mm"), computed server-side so the
  // form shows property-local time whatever timezone the host's device is in.
  initialFrom: string;
  initialTo: string;
}

export function AccessCodeValidityEditor({ accessCodeId, initialFrom, initialTo }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [saved, setSaved] = useState(false);

  function cancel() {
    setFrom(initialFrom);
    setTo(initialTo);
    setError("");
    setWarning("");
    setOpen(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    setWarning("");
    try {
      const res = await fetch("/api/reservations/access-code", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCodeId, validFrom: from, validTo: to }),
      });
      const data = await res.json();

      if (!res.ok && res.status !== 207) {
        setError(data.error || "Could not update the code.");
        return;
      }
      // 207: saved in StayHQ, but the lock itself rejected the change.
      if (data.lockError) setWarning(data.lockError);

      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      if (!data.lockError) setOpen(false);
      router.refresh(); // re-read the stored window from the server
    } catch {
      setError("Network error — the code was not updated.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Clock className="w-3.5 h-3.5" />
          Change validity
        </button>
        {saved && <span className="ml-2 text-xs font-medium text-emerald-600">Updated ✓</span>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-700 mb-2">
        Change validity <span className="font-normal text-slate-400">(CET)</span>
      </p>

      <div className="space-y-2">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Guest can enter from</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Code stops working at</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 border border-red-200 p-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-700">{error}</p>
        </div>
      )}
      {warning && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 p-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800">
            Saved in StayHQ, but the lock did not accept it: {warning}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? "Updating lock…" : "Save"}
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
