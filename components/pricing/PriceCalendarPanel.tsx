"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Info } from "lucide-react";
import { formatCurrency, SOURCE_LABELS } from "@/lib/utils";

// The month grid + click-to-edit panel from /pricing/calendar, extracted so
// it can be mounted for one property at a time from somewhere other than
// that page - e.g. a bottom sheet opened from the main Calendar tab -
// without a second implementation drifting out of sync with the original.
// Everything here is unchanged behavior, just parameterized by `property`
// instead of owning its own property picker.

export interface PriceCalendarProperty {
  id: string;
  name: string;
  currency: string;
  channelProvider: string;
}

interface Stay { id: string; guestName: string; source: string; }
interface DayRate {
  price: number | null;
  minStay: number | null;
  available?: number | boolean | null;
  blocked?: boolean;
  blockReason?: string | null;
  manual?: boolean;
  ruleIds?: string[];
  stay?: Stay | null;
}
interface RuleMeta {
  id: string;
  name: string;
  ruleType: string;
  price: number | null;
  adjustment: number | null;
  adjType: string | null;
  minNights: number | null;
  priority: number;
  daysOfWeek: string | null;
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Soft channel tints for a booked day. The solid equivalents on the main
// Calendar tab sit on a booking bar with white text; here the same colour has
// to carry a price in dark text as well, so these are the light versions.
const STAY_TINT: Record<string, string> = {
  BOOKING: "bg-blue-50 border-blue-200",
  AIRBNB: "bg-rose-50 border-rose-200",
  VRBO: "bg-green-50 border-green-200",
  EXPEDIA: "bg-amber-50 border-amber-200",
  DIRECT: "bg-violet-50 border-violet-200",
};
const STAY_TEXT: Record<string, string> = {
  BOOKING: "text-blue-700",
  AIRBNB: "text-rose-700",
  VRBO: "text-green-700",
  EXPEDIA: "text-amber-700",
  DIRECT: "text-violet-700",
};

const HATCH = "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(148,163,184,.28) 4px, rgba(148,163,184,.28) 8px)";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function fmtShort(key: string) {
  return new Date(key).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Only the first word fits in a calendar cell on a phone. The full name is
// still one tap away in the selection panel below the grid.
function firstName(name: string) {
  return (name || "").trim().split(/\s+/)[0] || name;
}

function ruleEffect(r: RuleMeta, currency: string): string {
  if (r.price != null) return formatCurrency(r.price, currency);
  if (r.adjustment != null) {
    return r.adjType === "FIXED"
      ? `${r.adjustment > 0 ? "+" : ""}${formatCurrency(r.adjustment, currency)}`
      : `${r.adjustment > 0 ? "+" : ""}${r.adjustment}%`;
  }
  return "—";
}

export default function PriceCalendarPanel({ property }: { property: PriceCalendarProperty }) {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); });
  const [rates, setRates] = useState<Record<string, DayRate>>({});
  const [rules, setRules] = useState<RuleMeta[]>([]);
  const [basePrice, setBasePrice] = useState<number | null>(null);
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

  const propId = property.id;
  const isChannex = property.channelProvider === "CHANNEX";
  const curCode = property.currency || "EUR";
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
      const path = isChannex
        ? `/api/pricing/materialized?propertyId=${propId}&start=${start}&end=${end}`
        : `/api/pricing/live?propertyId=${propId}&start=${start}&end=${end}`;
      const res = await fetch(path);
      const data = await res.json();
      setConnected(isChannex ? true : data.connected !== false);
      setRates(data.rates || {});
      setRules(Array.isArray(data.rules) ? data.rules : []);
      setBasePrice(typeof data.basePrice === "number" ? data.basePrice : null);
      if (data.error) setErr(data.error);
    } catch {
      setErr("Couldn't reach the server.");
    } finally { setLoading(false); }
  }, [propId, isChannex, year, month, daysInMonth]);
  useEffect(() => { load(); }, [load]);

  // Clear any in-progress selection when switching property or month, so a
  // selection can never be saved against the wrong context.
  useEffect(() => { setSelStart(null); setSelEnd(null); setSaveErr(""); }, [propId, year, month]);

  // Every date in the current selection, inclusive.
  const selectedKeys: string[] = [];
  if (selStart && selEnd) {
    const cur = new Date(selStart);
    const stop = new Date(selEnd);
    while (cur <= stop) { selectedKeys.push(ymd(cur)); cur.setUTCDate(cur.getUTCDate() + 1); }
  }

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

  // --- what the selection resolves to, and why ---
  const selPrices = selectedKeys.map((k) => rates[k]?.price).filter((p): p is number => p != null);
  const priceLo = selPrices.length ? Math.min(...selPrices) : null;
  const priceHi = selPrices.length ? Math.max(...selPrices) : null;

  // Rules touching the selection, with how many of the selected nights each
  // one actually covers - a weekend uplift hitting 2 of 4 nights is exactly
  // why the range has two different prices in it.
  const ruleHits = new Map<string, number>();
  for (const k of selectedKeys) for (const id of rates[k]?.ruleIds ?? []) ruleHits.set(id, (ruleHits.get(id) ?? 0) + 1);
  const activeRules = rules
    .filter((r) => ruleHits.has(r.id))
    .sort((a, b) => a.priority - b.priority);

  // Distinct stays inside the selection, in check-in order.
  const selStays: Array<Stay & { nights: number }> = [];
  for (const k of selectedKeys) {
    const s = rates[k]?.stay;
    if (!s) continue;
    const found = selStays.find((x) => x.id === s.id);
    if (found) found.nights += 1;
    else selStays.push({ ...s, nights: 1 });
  }

  // The min-stay most of this month sits at. A seasonal rule typically sets
  // one value across weeks at a time, so printing it on all 30 cells repeats
  // the same fact 30 times and buries the days that genuinely differ. The
  // prevailing value is stated once in the legend, and only exceptions get a
  // badge.
  const minStayCounts = new Map<number, number>();
  for (const r of Object.values(rates)) {
    if (r?.minStay) minStayCounts.set(r.minStay, (minStayCounts.get(r.minStay) ?? 0) + 1);
  }
  let prevailingMinStay: number | null = null;
  let prevailingCount = 0;
  for (const [v, c] of minStayCounts) if (c > prevailingCount) { prevailingCount = c; prevailingMinStay = v; }

  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-slate-500 text-sm">
          {isChannex
            ? "Tap a date, then another, to set a price for that range. Pushes to Channex automatically."
            : "A read-only view of your current rates in Smoobu (managed by PriceLabs)."}
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setCursor(new Date(Date.UTC(year, month - 1, 1)))} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-800 w-36 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(Date.UTC(year, month + 1, 1)))} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {property.channelProvider === "NONE" ? (
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
        /* Sized to the viewport, never wider: seven equal columns that shrink
           with the screen instead of forcing a sideways scroll. */
        <div className="bg-white rounded-2xl border border-slate-100 p-2 sm:p-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1 sm:mb-1.5">
            {WD.map((d) => (
              <div key={d} className="text-center text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wide py-1">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const key = ymd(new Date(Date.UTC(year, month, day)));
              const r = rates[key];
              const stay = r?.stay ?? null;
              // The Smoobu path reports availability as a number and has no
              // block/stay breakdown; the Channex path reports both.
              const unavailable = r && (r.available === 0 || r.available === false);
              const blocked = !!r?.blocked;
              const inSelection = isChannex && selStart != null && (selEnd ? key >= selStart && key <= selEnd : key === selStart);

              const cell = (
                <>
                  <div className="flex items-baseline justify-between gap-0.5">
                    <span className="text-[10px] leading-none text-slate-400">{day}</span>
                    <span className="flex items-center gap-0.5">
                      {r?.manual && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Manually set" />}
                      {r?.minStay && r.minStay !== prevailingMinStay ? (
                        <span className="text-[9px] leading-none font-medium text-slate-500" title="Minimum nights">{r.minStay}n</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-auto">
                    {loading ? (
                      <span className="text-[11px] text-slate-300">…</span>
                    ) : r?.price != null ? (
                      <span className={`block text-[11px] sm:text-sm font-semibold leading-tight tabular-nums truncate ${unavailable ? "text-slate-400" : "text-slate-900"}`}>
                        {formatCurrency(r.price, curCode)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                    {stay ? (
                      <span className={`block text-[9px] sm:text-[10px] font-medium leading-tight truncate ${STAY_TEXT[stay.source] || "text-slate-500"}`}>
                        {firstName(stay.guestName)}
                      </span>
                    ) : blocked ? (
                      <span className="block text-[9px] sm:text-[10px] font-medium leading-tight text-slate-500 truncate">Blocked</span>
                    ) : unavailable ? (
                      <span className="block text-[9px] sm:text-[10px] font-medium leading-tight text-rose-500 truncate">Booked</span>
                    ) : null}
                  </div>
                </>
              );

              const tint = stay
                ? STAY_TINT[stay.source] || "bg-slate-50 border-slate-200"
                : blocked
                ? "bg-slate-50 border-slate-200"
                : unavailable
                ? "bg-slate-50 border-slate-100"
                : "bg-white border-slate-100";

              const cellClass = `rounded-lg border p-1 sm:p-2 min-h-[62px] sm:min-h-[78px] flex flex-col text-left overflow-hidden transition ${
                inSelection ? "bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400" : tint
              } ${isChannex ? "hover:border-indigo-300 cursor-pointer" : ""}`;

              const style = blocked && !inSelection ? { backgroundImage: HATCH } : undefined;

              return isChannex ? (
                <button key={key} type="button" onClick={() => onDayClick(key)} className={cellClass} style={style}>{cell}</button>
              ) : (
                <div key={key} className={cellClass} style={style}>{cell}</div>
              );
            })}
          </div>

          {/* Legend — the four states a day can actually be in, in the same
              swatch-and-label form the OTA extranets use. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 pt-3 border-t border-slate-100">
            <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
              <i className="w-4 h-4 rounded border border-slate-300 bg-white" /> Bookable
            </span>
            <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
              <i className="w-4 h-4 rounded border border-blue-300 bg-blue-50" /> Booked
            </span>
            {/* Blocks and manual overrides are concepts of StayHQ's own rule
                engine - the Smoobu mirror can't report either, so its legend
                doesn't claim states its days can never be in. */}
            {isChannex && (
              <>
                <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                  <i className="w-4 h-4 rounded border border-slate-300 bg-slate-100" style={{ backgroundImage: HATCH }} /> Blocked
                </span>
                <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600">
                  <i className="w-4 h-4 rounded border border-indigo-200 bg-white flex items-center justify-center">
                    <i className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  </i>
                  Manually priced
                </span>
              </>
            )}
            <span className="text-[11px] sm:text-xs text-slate-400">
              {prevailingMinStay
                ? <>Min. stay <strong className="text-slate-500">{prevailingMinStay} night{prevailingMinStay === 1 ? "" : "s"}</strong> unless marked <strong className="text-slate-500">Nn</strong></>
                : <><strong className="text-slate-500">Nn</strong> = min. nights</>}
            </span>
          </div>
        </div>
      )}

      {isChannex && selStart && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4 sm:p-5 mt-4">
          {!selEnd ? (
            <p className="text-sm text-slate-700">
              <strong>{fmtShort(selStart)}</strong> selected — tap an end date for a range, or tap it again for one night.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
                <h3 className="font-semibold text-slate-900">
                  {selStart === selEnd ? fmtShort(selStart) : `${fmtShort(selStart)} — ${fmtShort(selEnd)}`}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {selectedKeys.length} night{selectedKeys.length === 1 ? "" : "s"}
                  </span>
                </h3>
                {priceLo != null && (
                  <span className="text-sm text-slate-500">
                    Currently{" "}
                    <strong className="text-slate-900">
                      {priceLo === priceHi
                        ? formatCurrency(priceLo, curCode)
                        : `${formatCurrency(priceLo, curCode)} – ${formatCurrency(priceHi!, curCode)}`}
                    </strong>
                  </span>
                )}
              </div>

              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Price / night ({curCode})</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Min. nights</label>
                  <input
                    type="number"
                    inputMode="numeric"
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

              {/* What is setting the price on these dates - the equivalent of
                  the rate-plan list an OTA extranet shows for a selection.
                  Listed lowest priority first, which is the order they are
                  actually applied in. */}
              <div className="mt-5">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  What sets this price
                </h4>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {basePrice != null && (
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">Base rate</p>
                        <p className="text-[11px] text-slate-400">The property&apos;s default, before any rule</p>
                      </div>
                      <span className="text-sm font-medium text-slate-700 shrink-0 tabular-nums">
                        {formatCurrency(basePrice, curCode)}
                      </span>
                    </div>
                  )}
                  {activeRules.map((r) => {
                    const hits = ruleHits.get(r.id) ?? 0;
                    const partial = hits < selectedKeys.length;
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">{r.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {partial ? `${hits} of ${selectedKeys.length} nights` : "All selected nights"}
                            {r.minNights && r.minNights > 1 ? ` · min ${r.minNights} nights` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-medium text-slate-700 shrink-0 tabular-nums">
                          {ruleEffect(r, curCode)}
                        </span>
                      </div>
                    );
                  })}
                  {activeRules.length === 0 && (
                    <div className="px-3 py-2.5 text-[11px] text-slate-400">
                      No pricing rules cover these dates — they sit at the base rate.
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Saving above adds a rule that overrides everything listed here. Remove it later on the{" "}
                  <Link href="/pricing" className="underline">Pricing rules</Link> page.
                </p>
              </div>

              {selStays.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Guests staying
                  </h4>
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                    {selStays.map((s) => (
                      <Link
                        key={s.id}
                        href={`/reservations/${s.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 transition"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">{s.guestName}</p>
                          <p className="text-[11px] text-slate-400">
                            {SOURCE_LABELS[s.source] || s.source} · {s.nights} night{s.nights === 1 ? "" : "s"} in this range
                          </p>
                        </div>
                        <span className={`text-xs shrink-0 ${STAY_TEXT[s.source] || "text-slate-500"}`}>View →</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}

      <p className="flex items-center gap-1.5 mt-4 text-xs text-slate-500">
        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
        {isChannex
          ? "Prices come from your own pricing rules and push to Channex automatically."
          : "Prices & min-nights are live from Smoobu — read-only, set them in PriceLabs."}
      </p>
    </div>
  );
}
