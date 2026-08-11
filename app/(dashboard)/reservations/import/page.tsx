"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { ChevronLeft, Upload, FileDown, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";

interface PreviewRow {
  index: number;
  property?: string;
  checkIn?: string;
  checkOut?: string;
  guestName?: string;
  totalAmount?: number;
  currency?: string;
  source?: string;
  status?: string;
  confirmationCode?: string;
  errors: string[];
  duplicate: string | null;
  liveWindowWarning: string | null;
}
interface PreviewResult {
  summary: { total: number; ok: number; duplicates: number; errors: number; liveWindowWarnings: number };
  rows: PreviewRow[];
}

const TEMPLATE_CSV =
  "property,checkIn,checkOut,guestName,totalAmount,currency,source,status,confirmationCode\n" +
  "29th floor Luxury Skyline 1BDRM Apart Downtown Bratislava,2026-03-10,2026-03-13,Jane Doe,285,EUR,Booking.com,CHECKED_OUT,HMKW8AND9N\n";

const DEFAULT_SOURCE_OPTIONS = [
  { value: "BOOKING", label: "Booking.com" },
  { value: "AIRBNB", label: "Airbnb" },
  { value: "VRBO", label: "VRBO" },
  { value: "EXPEDIA", label: "Expedia" },
  { value: "DIRECT", label: "Direct" },
];

export default function BulkImportReservationsPage() {
  const [csv, setCsv] = useState("");
  const [defaultSource, setDefaultSource] = useState("BOOKING");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<{ updated: number; to: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stayhq-reservations-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  async function runPreview() {
    setPreviewing(true);
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const res = await fetch("/api/reservations/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, mode: "preview", defaultSource }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Preview failed."); return; }
      setPreview(data);
      // Duplicates default to excluded — importing one has to be a deliberate
      // opt-in, never the default.
      setExcluded(new Set(data.rows.filter((r: PreviewRow) => r.duplicate).map((r: PreviewRow) => r.index)));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (!preview) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/reservations/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, mode: "commit", excludeRows: [...excluded], defaultSource }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Import failed."); return; }
      setResult(data);
      setPreview(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setImporting(false);
    }
  }

  async function runFixSource() {
    if (!confirm('Relabel every previously bulk-imported reservation still marked "Direct" as Booking.com?')) return;
    setFixing(true);
    setFixResult(null);
    try {
      const res = await fetch("/api/reservations/bulk-import/fix-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "BOOKING" }),
      });
      const data = await res.json();
      if (res.ok) setFixResult(data);
    } finally {
      setFixing(false);
    }
  }

  function toggleRow(index: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  const includedCount = preview ? preview.rows.filter((r) => r.errors.length === 0 && !excluded.has(r.index)).length : 0;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <Link href="/reservations" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ChevronLeft className="w-4 h-4" /> Back to Reservations
      </Link>

      <h1 className="text-xl md:text-2xl font-bold text-slate-900">Bulk import historical reservations</h1>
      <p className="text-slate-500 text-sm mt-0.5 mb-5">
        Backfill stays Smoobu never picked up — either from before you connected it, or older than the 90-day
        sync window — so your yearly financial reports are complete.
      </p>

      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3 mb-6">
        <Info className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-indigo-900">
          <p className="font-medium">This only creates historical records</p>
          <p className="text-indigo-800/80 mt-1">
            No door PIN codes are generated, no message is sent to any guest, and you won&apos;t get a
            notification for these — they exist purely so Finance can total up the year correctly.
          </p>
        </div>
      </div>

      {!preview && !result && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6">
          <p className="text-sm text-amber-900">
            Already imported reservations that ended up flagged as <span className="font-medium">Direct</span> instead
            of the real platform? Relabel them in one go.
          </p>
          <button
            onClick={runFixSource}
            disabled={fixing}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap"
          >
            {fixing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            {fixing ? "Fixing…" : "Fix previously imported → Booking.com"}
          </button>
        </div>
      )}
      {fixResult && !preview && !result && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 mb-6">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">
            {fixResult.updated === 0
              ? "Nothing to fix — no bulk-imported reservations were on Direct."
              : `${fixResult.updated} reservation${fixResult.updated === 1 ? "" : "s"} relabeled to Booking.com.`}
          </p>
        </div>
      )}

      {!preview && !result && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-slate-900 text-sm">1. Paste or upload CSV</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 text-xs border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg font-medium transition"
              >
                <FileDown className="w-3.5 h-3.5" /> Download template
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg font-medium transition"
              >
                <Upload className="w-3.5 h-3.5" /> Upload .csv
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Required columns: <span className="font-mono">property, checkIn, checkOut</span> (dates as YYYY-MM-DD).
            Optional: <span className="font-mono">guestName, guestEmail, totalAmount, currency, source, status, confirmationCode, notes</span>.
            <span className="font-mono">property</span> must match one of your property names; <span className="font-mono">source</span> accepts
            Booking.com / Airbnb / VRBO / Expedia / Direct.
          </p>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Default source</label>
            <select
              value={defaultSource}
              onChange={(e) => setDefaultSource(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {DEFAULT_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="text-xs text-slate-400">used for rows with no explicit source column — e.g. a raw Booking.com Extranet export</span>
          </div>

          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={TEMPLATE_CSV}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={runPreview}
            disabled={previewing || !csv.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            {previewing ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            {previewing ? "Checking…" : "Preview"}
          </button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <h2 className="font-semibold text-slate-900 text-sm">2. Review before importing</h2>
              <button onClick={() => setPreview(null)} className="text-xs text-slate-500 hover:text-slate-700">
                Start over
              </button>
            </div>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-emerald-700">{preview.summary.ok}</span> ready ·{" "}
              <span className="font-medium text-amber-700">{preview.summary.duplicates}</span> possible duplicates
              (excluded by default) ·{" "}
              <span className="font-medium text-red-700">{preview.summary.errors}</span> will be skipped (errors)
              {preview.summary.liveWindowWarnings > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-sky-700">{preview.summary.liveWindowWarnings}</span> are recent/upcoming
                </>
              )}
            </p>
            {preview.summary.liveWindowWarnings > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 p-3">
                <Info className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800">
                  Rows marked with a check-in in the last 90 days or later are inside Smoobu&apos;s live sync
                  range. If a stay is genuinely still upcoming, it should come through the normal Smoobu sync
                  instead — that path also generates the door PIN and sends the guest their messages, which
                  this bulk import does not. Double-check these aren&apos;t already in StayHQ before including them.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wide">
                  <th className="text-left px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Property</th>
                  <th className="text-left px-3 py-2">Dates</th>
                  <th className="text-left px-3 py-2">Guest</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2 w-10"></th>
                  <th className="text-left px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const hasError = r.errors.length > 0;
                  const isDup = !!r.duplicate;
                  const isOut = hasError || excluded.has(r.index);
                  return (
                    <tr key={r.index} className={`border-b border-slate-50 ${isOut ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2">
                        {hasError ? (
                          <XCircle className="w-4 h-4 text-red-500" />
                        ) : isDup ? (
                          <input
                            type="checkbox"
                            checked={!excluded.has(r.index)}
                            onChange={() => toggleRow(r.index)}
                            className="w-4 h-4 rounded accent-amber-600"
                            title="Import this one anyway"
                          />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-[160px] truncate">{r.property || "—"}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.checkIn} → {r.checkOut}</td>
                      <td className="px-3 py-2 text-slate-600">{r.guestName || "—"}</td>
                      <td className="px-3 py-2 text-slate-700 text-right tabular-nums">
                        {r.totalAmount != null ? `${r.totalAmount} ${r.currency || ""}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.source}</td>
                      <td className="px-3 py-2 text-slate-600">{r.status}</td>
                      <td className="px-3 py-2">
                        {r.liveWindowWarning && r.errors.length === 0 && (
                          <Info className="w-3.5 h-3.5 text-sky-500" />
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[220px]">
                        {hasError ? (
                          <span className="text-red-600">{r.errors.join(" ")}</span>
                        ) : isDup ? (
                          <span className="text-amber-700">{r.duplicate}</span>
                        ) : r.liveWindowWarning ? (
                          <span className="text-sky-700">{r.liveWindowWarning}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={runImport}
            disabled={importing || includedCount === 0}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            {importing ? "Importing…" : `Import ${includedCount} reservation${includedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <p className="text-slate-900 font-semibold">
            {result.created} reservation{result.created === 1 ? "" : "s"} imported
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-slate-500 mt-1">{result.skipped} row(s) skipped (errors or excluded duplicates).</p>
          )}
          <div className="flex items-center justify-center gap-3 mt-4">
            <Link href="/reservations" className="text-sm text-indigo-600 hover:underline font-medium">
              View reservations
            </Link>
            <Link href="/finance" className="text-sm text-indigo-600 hover:underline font-medium">
              View finance report
            </Link>
            <button
              onClick={() => { setResult(null); setCsv(""); }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Import more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
