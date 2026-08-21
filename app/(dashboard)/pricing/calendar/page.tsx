"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Property { id: string; name: string; currency: string; channelProvider: string; }
interface DayRate { price: number | null; minStay: number | null; available: number | boolean | null; manual?: boolean; }

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function fmtShort(key: string) {
  return new Date(key).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function LivePricingCalendar() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propId, setPropId] = useState("");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); });
  const [rates, setRates] = useState<Record<string, DayRate>>({});
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Editable, drag-to-select range - only meaningful for Channex properties,
  // whose prices live in StayHQ's own rule engine. Smoobu-managed properties
  // are set in PriceLabs, so there is nothing here to edit for them; the
  // calendar stays the read-only Smoobu mirror it always was.
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editMinNights, setEditMinNights] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((data) => {
      const list = Array.isArray(data) ? data : [];
      setProperties(list);
      if (list.length) setPropId(list[0].id);
    });
  }, []);

  const property = properties.find((p) => p.id === propId);
  const isChannex = property?.channelProvider === "CHANNEX";
  const curCode = property?.currency || "EUR";
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Mon-first

  const load = useCallback(async () => {
    if (!propId || !property) return;
    setLoading(true); setErr("");
    const start = ymd(new Date(Date.UTC(year, month, 1)));
    const end = ymd(new Date(Date.UTC(year, month, daysInMonth)));
    try {
      const path = property.channelProvider === "CHANNEX"
        ? `/api/pricing/materialized?propertyId=${propId}&start=${start}&end=${end}`
        : `/api/pricing/live?propertyId=${propId}&start=${start}&end=${end}`;
      const res = await fetch(path);
      const data = await res.json();
      setConnected(property.channelProvider === "CHANNEX" ? true : data.connected !== false);
      setRates(data.rates || {});
      if (data.error) setErr(data.error);
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setLoading(false); }
  }, [propId, property, year, month, daysInMonth]);
  useEffect(() => { load(); }, [load]);

  // Clear any in-progress selection when switching property or month, so a
  // selection can never be saved against the wrong context.
  useEffect(() => { setSelStart(null); setSelEnd(null); setSaveErr(""); }, [propId, year, month]);

  useEffect(() => {
    if (selStart && selEnd) {
      const r = rates[selStart];
      setEditPrice(r?.price != null ? String(Math.round(r.price)) : "");
      setEditMinNights(String(r?.minStay || 1));
    }
  }, [selStart, selEnd, rates]);

  function onDayClick(key: string) {
    if (!isChannex) return;
    setSaveErr("");
    if (!selStart || selEnd) {
      setSelStart(key); setSelEnd(null);
      return;
    }
    if (key < selStart) { setSelEnd(selStart); setSelStart(key); }
    else setSelEnd(key);
  }

  async function saveOverride() {
    if (!selStart || !selEnd || !propId || !editPrice) return;
    setSaving(true); setSaveErr("");
    const res = await fetch("/api/pricing/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: propId,
        startDate: selStart,
        endDate: selEnd,
        price: Number(editPrice),
        minNights: Number(editMinNights) || 1,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSelStart(null); setSelEnd(null);
      load();
      return;
    }
    const detail = await res.json().catch(() => null);
    setSaveErr(typeof detail?.error === "string" ? detail.error : "Could not save this price.");
  }

  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{isChannex ? "Prices" : "Live Prices"}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isChannex
              ? "Click a date, then another, to set a price for that range. Pushes to Channex automatically."
              : "A read-only view of your current rates in Smoobu (managed by PriceLabs)."}
          </p>
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

      {property?.channelProvider === "NONE" ? (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">This property isn&apos;t connected to a channel manager</p>
            <p className="text-amber-800/80 mt-1">Connect it under Settings → Channels to manage prices here.</p>
          </div>
        </div>
      ) : !connected ? (
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
                const unavailable = r && (r.available === 0 || r.available === false);
                const inSelection = isChannex && selStart != null && (selEnd ? key >= selStart && key <= selEnd : key === selStart);

                const cell = (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{day}</span>
                      <div className="flex items-center gap-1">
                        {r?.manual && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Manually set" />}
                        {r?.minStay ? <span className="text-[10px] text-slate-400" title="Minimum nights">{r.minStay}n+</span> : null}
                      </div>
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
                  </>
                );

                const cellClass = `rounded-lg border p-2 min-h-[74px] flex flex-col text-left transition ${
                  inSelection
                    ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-300"
                    : unavailable
                    ? "bg-slate-50 border-slate-100"
                    : r?.manual
                    ? "bg-white border-indigo-100"
                    : "bg-white border-slate-100"
                } ${isChannex ? "hover:border-indigo-300 cursor-pointer" : ""}`;

                return isChannex ? (
                  <button key={key} type="button" onClick={() => onDayClick(key)} className={cellClass}>{cell}</button>
                ) : (
                  <div key={key} className={cellClass}>{cell}</div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isChannex && selStart && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mt-4">
          {!selEnd ? (
            <p className="text-sm text-indigo-900">
              <strong>{fmtShort(selStart)}</strong> selected — click an end date to set a range, or click it again for one night.
            </p>
          ) : (
            <>
              <h3 className="font-semibold text-slate-900 mb-3">
                {selStart === selEnd ? fmtShort(selStart) : `${fmtShort(selStart)} — ${fmtShort(selEnd)}`}
              </h3>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Price / night ({curCode})</label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Min. nights</label>
                  <input
                    type="number"
                    min="1"
                    value={editMinNights}
                    onChange={(e) => setEditMinNights(e.target.value)}
                    className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={saveOverride}
                  disabled={saving || !editPrice}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {saving ? "Saving…" : "Save price"}
                </button>
                <button
                  onClick={() => { setSelStart(null); setSelEnd(null); }}
                  className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
                >
                  Cancel
                </button>
              </div>
              {saveErr && <p className="text-xs text-rose-600 mt-2">{saveErr}</p>}
              <p className="text-xs text-indigo-700/70 mt-3">
                Overrides whatever seasonal or weekend rule applies here. To remove it later, find it by name on the{" "}
                <Link href="/pricing" className="underline">Pricing rules</Link> page.
              </p>
            </>
          )}
        </div>
      )}

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}

      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500 flex-wrap">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {isChannex ? "Prices from your own pricing rules" : "Prices & min-nights are live from Smoobu"}</span>
        <span><strong className="text-slate-600">Nn+</strong> = minimum nights</span>
        <span><span className="text-rose-500 font-medium">Booked</span> = date is taken</span>
        {isChannex ? (
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> Manually set</span>
        ) : (
          <span className="text-slate-400">Read-only — set prices in PriceLabs</span>
        )}
      </div>
    </div>
  );
}
