"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Property { id: string; name: string; currency: string; }
interface DayRate { price: number | null; minStay: number | null; available: number | null; }

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default function LivePricingCalendar() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propId, setPropId] = useState("");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); });
  const [rates, setRates] = useState<Record<string, DayRate>>({});
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((data) => {
      setProperties(data || []);
      if (data?.length) setPropId(data[0].id);
    });
  }, []);

  const property = properties.find((p) => p.id === propId);
  const curCode = property?.currency || "EUR";
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Mon-first

  const load = useCallback(async () => {
    if (!propId) return;
    setLoading(true); setErr("");
    const start = ymd(new Date(Date.UTC(year, month, 1)));
    const end = ymd(new Date(Date.UTC(year, month, daysInMonth)));
    try {
      const res = await fetch(`/api/pricing/live?propertyId=${propId}&start=${start}&end=${end}`);
      const data = await res.json();
      setConnected(data.connected !== false);
      setRates(data.rates || {});
      if (data.error) setErr(data.error);
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setLoading(false); }
  }, [propId, year, month, daysInMonth]);
  useEffect(() => { load(); }, [load]);

  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Live Prices</h1>
          <p className="text-slate-500 text-sm mt-0.5">A read-only view of your current rates in Smoobu (managed by PriceLabs).</p>
        </div>
        <Link href="/pricing" className="text-sm text-slate-500 hover:text-slate-800">Pricing rules →</Link>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 mt-5 mb-4 flex-wrap">
        <select
          value={propId}
          onChange={(e) => setPropId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[280px]"
        >
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(Date.UTC(year, month - 1, 1)))} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-800 w-36 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(Date.UTC(year, month + 1, 1)))} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {!connected ? (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">This property isn&apos;t mapped to Smoobu</p>
            <p className="text-amber-800/80 mt-1">Map it under Settings → Smoobu to see its live prices here.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 p-3 md:p-4 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {WD.map((d) => <div key={d} className="text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wide py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const key = ymd(new Date(Date.UTC(year, month, day)));
                const r = rates[key];
                const unavailable = r && r.available === 0;
                return (
                  <div key={key} className={`rounded-lg border p-2 min-h-[74px] flex flex-col ${unavailable ? "bg-slate-50 border-slate-100" : "bg-white border-slate-150 border-slate-100"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{day}</span>
                      {r?.minStay ? <span className="text-[10px] text-slate-400" title="Minimum nights">{r.minStay}n+</span> : null}
                    </div>
                    <div className="flex-1 flex items-end">
                      {loading ? (
                        <span className="text-xs text-slate-300">…</span>
                      ) : r?.price != null ? (
                        <span className={`text-sm font-semibold ${unavailable ? "text-slate-400 line-through" : "text-slate-900"}`}>{formatCurrency(r.price, curCode)}</span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                    {unavailable && <span className="text-[10px] text-rose-500 font-medium">Booked</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}

      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Prices &amp; min-nights are live from Smoobu</span>
        <span><strong className="text-slate-600">Nn+</strong> = minimum nights</span>
        <span><span className="text-rose-500 font-medium">Booked</span> = date is taken</span>
        <span className="text-slate-400">Read-only — set prices in PriceLabs</span>
      </div>
    </div>
  );
}
