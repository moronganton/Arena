"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Plus, CalendarDays } from "lucide-react";

interface Reservation {
  id: string;
  checkIn: string;
  checkOut: string;
  status: string;
  source: string;
  totalAmount?: number | null;
  currency?: string;
  createdAt?: string;
  guest: { name: string };
  property: { id: string; name: string; city: string };
}

const CUR: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", RON: "lei ", CHF: "CHF " };
const curSym = (c?: string) => (c ? CUR[c] || c + " " : "");
const ddmm = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
};

interface Block {
  id: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  property: { id: string; name: string };
}

interface Property {
  id: string;
  name: string;
  city: string;
  active?: boolean;
}

// Timeline geometry
const DAY_W = 48; // px per day column
const LABEL_W = 116; // px for the pinned property column
const HEAD_H = 48;
const ROW_H = 54;
const WINDOW = 30; // days shown per page

// Solid channel colors for the booking bars (SOURCE_COLORS are the soft badges)
const BAR_COLORS: Record<string, string> = {
  BOOKING: "bg-blue-600",
  AIRBNB: "bg-rose-600",
  VRBO: "bg-green-600",
  EXPEDIA: "bg-amber-500",
  DIRECT: "bg-violet-600",
};

const LEGEND = [
  { source: "BOOKING", label: "Booking.com", dot: "bg-blue-600" },
  { source: "AIRBNB", label: "Airbnb", dot: "bg-rose-600" },
  { source: "VRBO", label: "VRBO", dot: "bg-green-600" },
  { source: "DIRECT", label: "Direct", dot: "bg-violet-600" },
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dayIndex(from: Date, date: Date) {
  return Math.round((startOfDay(date).getTime() - startOfDay(from).getTime()) / 86400000);
}
// Local calendar-day key (YYYY-MM-DD) to match Smoobu's per-night rate keys
function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Clamp a [start,end) range to the visible window; returns 0-indexed start day + span
function placeBar(from: Date, start: Date, end: Date) {
  const s = Math.max(0, dayIndex(from, start));
  const e = Math.min(WINDOW, dayIndex(from, end));
  if (e <= 0 || s >= WINDOW || e <= s) return null;
  return { start: s, span: e - s, clippedStart: dayIndex(from, start) < 0, clippedEnd: dayIndex(from, end) > WINDOW };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const today = startOfDay(new Date());
  const [windowStart, setWindowStart] = useState(() => addDays(startOfDay(new Date()), -3));
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, Record<string, number>>>({});
  const [currency, setCurrency] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const windowEnd = addDays(windowStart, WINDOW);

  const load = useCallback(async () => {
    setLoading(true);
    const from = windowStart.toISOString();
    const to = windowEnd.toISOString();
    const [cal, props] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`).then((r) => r.json()),
      fetch(`/api/properties`).then((r) => r.json()),
    ]);
    setReservations(cal.reservations || []);
    setBlocks(cal.blocks || []);
    setProperties(
      Array.isArray(props)
        ? props.filter((p: Property) => p.active !== false).map((p: Property) => ({ id: p.id, name: p.name, city: p.city }))
        : []
    );
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  useEffect(() => {
    load();
  }, [load]);

  // Live Smoobu prices for the visible window (read-only overlay). Separate from
  // the main load so the calendar renders immediately and prices fill in after.
  useEffect(() => {
    const start = ymdLocal(windowStart);
    const end = ymdLocal(addDays(windowStart, WINDOW - 1));
    let cancelled = false;
    fetch(`/api/pricing/live-batch?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPrices(data.prices || {});
        setCurrency(data.currency || {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  // Scroll so "today" sits near the left edge whenever it's in range
  useEffect(() => {
    const todayIdx = dayIndex(windowStart, today);
    if (scrollRef.current && todayIdx > 2 && todayIdx < WINDOW) {
      scrollRef.current.scrollLeft = (todayIdx - 2) * DAY_W;
    } else if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, windowStart]);

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const rangeLabel = `${fmt(windowStart)} – ${fmt(addDays(windowStart, WINDOW - 1))}, ${windowStart.getFullYear()}`;

  const resByProperty = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (r.status === "CANCELLED") continue;
    const arr = resByProperty.get(r.property.id) || [];
    arr.push(r);
    resByProperty.set(r.property.id, arr);
  }
  const blocksByProperty = new Map<string, Block[]>();
  for (const b of blocks) {
    const arr = blocksByProperty.get(b.property.id) || [];
    arr.push(b);
    blocksByProperty.set(b.property.id, arr);
  }

  const days = Array.from({ length: WINDOW }, (_, i) => addDays(windowStart, i));
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${WINDOW}, ${DAY_W}px)`,
    gridTemplateRows: `${HEAD_H}px repeat(${properties.length}, ${ROW_H}px)`,
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
        <div className="flex items-center gap-2">
          <a
            href="/api/calendar?format=ical"
            download="calendar.ics"
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 border border-slate-200 px-3 py-2 rounded-xl hover:border-indigo-200 transition"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export iCal</span>
          </a>
          <Link
            href="/reservations/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            New
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-3 border-b border-slate-100">
          <button
            onClick={() => setWindowStart((s) => addDays(s, -WINDOW))}
            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWindowStart((s) => addDays(s, WINDOW))}
            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWindowStart(addDays(today, -3))}
            className="text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition"
          >
            Today
          </button>
          <span className="text-sm font-semibold text-slate-800 ml-1 truncate">{rangeLabel}</span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 ml-auto">
            ↔ scroll to see more dates
          </span>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading calendar…</div>
        ) : properties.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm mb-3">No properties yet</p>
            <Link href="/properties/new" className="text-sm text-indigo-600 hover:underline">
              Add your first property
            </Link>
          </div>
        ) : (
          <div className="flex">
            {/* Frozen property column (outside the horizontal scroll) */}
            <div className="shrink-0 border-r border-slate-200 bg-white" style={{ width: LABEL_W }}>
              <div
                className="border-b border-slate-200 flex items-center px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400"
                style={{ height: HEAD_H }}
              >
                Property
              </div>
              {properties.map((p) => (
                <div
                  key={`lab-${p.id}`}
                  className="border-b border-slate-100 px-3 flex flex-col justify-center"
                  style={{ height: ROW_H }}
                >
                  <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{p.city}</p>
                </div>
              ))}
            </div>

            {/* Horizontally scrollable day grid */}
            <div ref={scrollRef} className="overflow-x-auto flex-1">
              <div style={gridStyle}>
                {/* Day headers */}
                {days.map((d, i) => {
                  const isToday = dayIndex(today, d) === 0;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={i}
                      className={`border-b border-r border-slate-100 flex flex-col items-center justify-center ${
                        isToday ? "bg-indigo-50" : isWeekend ? "bg-slate-50" : "bg-white"
                      }`}
                      style={{ gridRow: 1, gridColumn: i + 1 }}
                    >
                      <span className="text-[9px] font-bold uppercase text-slate-400">{DOW[d.getDay()][0]}</span>
                      <span className={`text-sm font-bold ${isToday ? "text-indigo-600" : "text-slate-700"}`}>
                        {d.getDate()}
                      </span>
                    </div>
                  );
                })}

                {/* Background cells — with the live Smoobu rate for that day */}
                {properties.map((p, r) =>
                  days.map((d, i) => {
                    const isToday = dayIndex(today, d) === 0;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const price = prices[p.id]?.[ymdLocal(d)];
                    return (
                      <div
                        key={`c-${p.id}-${i}`}
                        className={`border-b border-r border-slate-50 flex items-end justify-center pb-1 ${
                          isToday ? "bg-indigo-50/40" : isWeekend ? "bg-slate-50/50" : ""
                        }`}
                        style={{ gridRow: r + 2, gridColumn: i + 1 }}
                      >
                        {price != null && (
                          <span className="text-[9px] font-medium text-slate-400 tabular-nums leading-none">
                            {currency[p.id] || ""}{price.toLocaleString()}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Blocked ranges (behind bookings) */}
                {properties.map((p, r) =>
                  (blocksByProperty.get(p.id) || []).map((b) => {
                    const pos = placeBar(windowStart, new Date(b.startDate), addDays(new Date(b.endDate), 1));
                    if (!pos) return null;
                    return (
                      <div
                        key={`blk-${b.id}`}
                        className="z-[1] self-center mx-0.5 h-9 rounded-md bg-slate-200/70 border border-slate-300 flex items-center px-2 overflow-hidden"
                        style={{
                          gridRow: r + 2,
                          gridColumn: `${pos.start + 1} / span ${pos.span}`,
                          backgroundImage:
                            "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(148,163,184,.25) 5px, rgba(148,163,184,.25) 10px)",
                        }}
                      >
                        <span className="text-[10px] font-medium text-slate-500 truncate">
                          {b.reason || "Blocked"}
                        </span>
                      </div>
                    );
                  })
                )}

                {/* Booking bars */}
                {properties.map((p, r) =>
                  (resByProperty.get(p.id) || []).map((res) => {
                    const pos = placeBar(windowStart, new Date(res.checkIn), new Date(res.checkOut));
                    if (!pos) return null;
                    const nights = dayIndex(new Date(res.checkIn), new Date(res.checkOut));
                    return (
                      <Link
                        key={`res-${res.id}`}
                        href={`/reservations/${res.id}`}
                        className={`z-[2] self-center h-10 rounded-lg text-white shadow-sm flex flex-col justify-center px-2.5 overflow-hidden hover:brightness-110 transition ${
                          BAR_COLORS[res.source] || "bg-slate-500"
                        } ${pos.clippedStart ? "rounded-l-none" : ""} ${pos.clippedEnd ? "rounded-r-none" : ""}`}
                        style={{
                          gridRow: r + 2,
                          gridColumn: `${pos.start + 1} / span ${pos.span}`,
                          marginLeft: pos.clippedStart ? 0 : 3,
                          marginRight: pos.clippedEnd ? 0 : 3,
                        }}
                      >
                        <span className="text-[11px] font-bold leading-tight truncate">{res.guest.name}</span>
                        {pos.span > 1 && (
                          <span className="flex items-center justify-between gap-1 text-[9px] opacity-90 leading-tight">
                            <span className="truncate">
                              {nights}
                              {res.totalAmount != null ? ` · ${curSym(res.currency)}${res.totalAmount.toLocaleString()}` : ""}
                            </span>
                            {res.createdAt && (
                              <span className="shrink-0 opacity-80" title={`Booked ${ddmm(res.createdAt)}`}>{ddmm(res.createdAt)}</span>
                            )}
                          </span>
                        )}
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 border-t border-slate-100">
          {LEGEND.map((l) => (
            <span key={l.source} className="flex items-center gap-1.5 text-xs text-slate-600">
              <i className={`w-3 h-3 rounded ${l.dot}`} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <i
              className="w-3 h-3 rounded bg-slate-200 border border-slate-300"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(148,163,184,.4) 2px, rgba(148,163,184,.4) 4px)",
              }}
            />
            Blocked
          </span>
        </div>
      </div>
    </div>
  );
}
