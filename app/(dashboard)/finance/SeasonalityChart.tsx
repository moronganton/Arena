"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

interface MonthSummary {
  month: string; // YYYY-MM
  grossRevenue: number;
  totalCosts: number;
  netIncome: number;
  reservations: number;
}

interface RangeReport {
  months: MonthSummary[];
  totals: { grossRevenue: number; totalCosts: number; netIncome: number };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

// "3500 -> 3.5K", "18900 -> 18.9K", "1200000 -> 1.2M"
function formatCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1) + "M";
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1) + "K";
  return sign + Math.round(abs).toLocaleString();
}

const fmt = (n: number) => Math.round(n).toLocaleString();

const W_PER_MONTH = 88;
const MIN_W = 640;
const H = 320;
const PAD_L = 48, PAD_R = 16, PAD_T = 30, PAD_B = 28;

function niceMax(v: number): number {
  if (v <= 0) return 1000;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export default function SeasonalityChart({ propertyId }: { propertyId: string }) {
  const now = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const yearStart = useMemo(() => `${now.slice(0, 4)}-01`, [now]);

  const [startMonth, setStartMonth] = useState(yearStart);
  const [endMonth, setEndMonth] = useState(now);
  const [activePreset, setActivePreset] = useState<string>("ytd");
  const [data, setData] = useState<RangeReport | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [loading, setLoading] = useState(false);

  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    for (let i = -24; i <= 12; i++) opts.push(shiftMonth(now, i));
    return opts;
  }, [now]);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ from: startMonth, to: endMonth });
    if (propertyId) q.set("propertyId", propertyId);
    try {
      const res = await fetch(`/api/finance/report-range?${q.toString()}`);
      const json = await res.json();
      if (Array.isArray(json.months)) setData(json);
    } finally {
      setLoading(false);
    }
  }, [startMonth, endMonth, propertyId]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(key: string) {
    setActivePreset(key);
    if (key === "ytd") { setStartMonth(yearStart); setEndMonth(now); }
    else if (key === "3m") { setStartMonth(shiftMonth(now, -2)); setEndMonth(now); }
    else if (key === "6m") { setStartMonth(shiftMonth(now, -5)); setEndMonth(now); }
    else if (key === "12m") { setStartMonth(shiftMonth(now, -11)); setEndMonth(now); }
  }

  const months = data?.months ?? [];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const n = months.length;
  const width = Math.max(MIN_W, n * W_PER_MONTH);
  const plotW = width - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yMax = niceMax(Math.max(1, ...months.map((m) => m.grossRevenue)) * 1.2);

  const xAt = (i: number) => (n <= 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i) / (n - 1));
  const yAt = (v: number) => PAD_T + plotH - (plotH * Math.max(0, v)) / yMax;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    if (!svgRef.current || n === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - px);
      if (d < best) { best = d; idx = i; }
    }
    setHover({ idx, x: xAt(idx), y: PAD_T });
  }

  const groupW = n > 0 ? (plotW / n) * 0.62 : 90;
  const barW = Math.min(24, groupW / 2 - 3);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div>
          <h2 className="text-base font-bold text-slate-900">Revenue, costs &amp; net income over time</h2>
          <p className="text-slate-500 text-xs mt-0.5">Monthly, revenue recognized at checkout — spot the season</p>
        </div>
      </div>

      {/* Date range control */}
      <div className="flex flex-wrap items-end gap-2 mt-3 mb-4 border border-slate-100 rounded-xl p-3 bg-slate-50/60">
        <div className="flex gap-1.5 flex-wrap">
          {[
            ["ytd", "Year to date"],
            ["3m", "Last 3 months"],
            ["6m", "Last 6 months"],
            ["12m", "Last 12 months"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                activePreset === key
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start</label>
            <select
              value={startMonth}
              onChange={(e) => { setActivePreset("custom"); setStartMonth(e.target.value); }}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">End</label>
            <select
              value={endMonth}
              onChange={(e) => { setActivePreset("custom"); setEndMonth(e.target.value); }}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap mb-2 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#2a78d6" }} />Gross revenue</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#eb6834" }} />Total costs</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-0.5 rounded-sm" style={{ background: "#1baf7a" }} />Net income</span>
      </div>

      {/* Chart */}
      <div className="relative overflow-x-auto" style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.15s ease" }}>
        {n === 0 ? (
          <div className="text-sm text-slate-400 py-16 text-center">No data in this range.</div>
        ) : (
          <svg ref={svgRef} viewBox={`0 0 ${width} ${H}`} style={{ width: "100%", height: "auto", display: "block", minWidth: MIN_W }} role="img" aria-label="Bar chart of monthly gross revenue and total costs with a net income line overlay">
            {/* gridlines + y ticks */}
            {[0, 1, 2, 3, 4].map((t) => {
              const val = (yMax / 4) * t;
              const y = yAt(val);
              return (
                <g key={t}>
                  <line x1={PAD_L} x2={width - PAD_R} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />
                  <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10.5} fill="#94a3b8">{formatCompact(val)}</text>
                </g>
              );
            })}

            {/* bars + net line */}
            {months.map((d, i) => {
              const cx = xAt(i);
              const y0 = yAt(0);
              const rY = yAt(d.grossRevenue), cY = yAt(d.totalCosts);
              return (
                <g key={d.month}>
                  <rect x={cx - barW - 2} y={rY} width={barW} height={Math.max(0, y0 - rY)} rx={4} fill="#2a78d6" opacity={hover && hover.idx !== i ? 0.55 : 1} />
                  <text x={cx - barW - 2 + barW / 2} y={rY - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="#475569">{formatCompact(d.grossRevenue)}</text>
                  <rect x={cx + 2} y={cY} width={barW} height={Math.max(0, y0 - cY)} rx={4} fill="#eb6834" opacity={hover && hover.idx !== i ? 0.55 : 1} />
                  <text x={cx + 2 + barW / 2} y={cY - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="#475569">{formatCompact(d.totalCosts)}</text>
                </g>
              );
            })}
            <path
              d={months.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.netIncome)}`).join(" ")}
              fill="none" stroke="#1baf7a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
            {months.map((d, i) => (
              <circle key={d.month} cx={xAt(i)} cy={yAt(d.netIncome)} r={4} fill="#1baf7a" stroke="#ffffff" strokeWidth={2} />
            ))}

            {/* x labels */}
            {months.map((d, i) => (
              <text key={d.month} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize={10.5} fill="#94a3b8">{monthLabel(d.month)}</text>
            ))}

            {/* crosshair */}
            {hover && (
              <line x1={hover.x} x2={hover.x} y1={PAD_T} y2={PAD_T + plotH} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3,3" />
            )}

            {/* hit layer */}
            <rect
              x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent"
              onPointerMove={handleMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {/* tooltip */}
        {hover && months[hover.idx] && (
          <div
            className="absolute bg-slate-900 text-white rounded-lg px-3 py-2 text-xs pointer-events-none shadow-lg"
            style={{
              left: `min(max(${(hover.x / width) * 100}% + 10px, 4px), calc(100% - 170px))`,
              top: 6,
              whiteSpace: "nowrap",
            }}
          >
            <div className="font-bold opacity-90 mb-1">{monthLabel(months[hover.idx].month)}</div>
            <div className="flex justify-between gap-3"><span className="opacity-80 flex items-center gap-1.5"><span className="inline-block w-2.5 h-0.5" style={{ background: "#2a78d6" }} />Revenue</span><span className="font-bold tabular-nums">{fmt(months[hover.idx].grossRevenue)}</span></div>
            <div className="flex justify-between gap-3"><span className="opacity-80 flex items-center gap-1.5"><span className="inline-block w-2.5 h-0.5" style={{ background: "#eb6834" }} />Costs</span><span className="font-bold tabular-nums">{fmt(months[hover.idx].totalCosts)}</span></div>
            <div className="flex justify-between gap-3"><span className="opacity-80 flex items-center gap-1.5"><span className="inline-block w-2.5 h-0.5" style={{ background: "#1baf7a" }} />Net income</span><span className="font-bold tabular-nums">{fmt(months[hover.idx].netIncome)}</span></div>
          </div>
        )}
      </div>

      {/* period totals */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <div className="rounded-xl border border-slate-100 p-3 bg-slate-50/60">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Gross revenue (period)</div>
            <div className="text-lg font-bold" style={{ color: "#2a78d6" }}>{fmt(data.totals.grossRevenue)}</div>
          </div>
          <div className="rounded-xl border border-slate-100 p-3 bg-slate-50/60">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Total costs (period)</div>
            <div className="text-lg font-bold" style={{ color: "#eb6834" }}>{fmt(data.totals.totalCosts)}</div>
          </div>
          <div className={`rounded-xl border p-3 ${data.totals.netIncome >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Net income (period)</div>
            <div className={`text-lg font-bold ${data.totals.netIncome >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(data.totals.netIncome)}</div>
          </div>
        </div>
      )}

      <button
        onClick={() => setShowTable((v) => !v)}
        className="text-xs font-semibold text-indigo-600 mt-3"
      >
        {showTable ? "Hide" : "Show"} data table {showTable ? "▴" : "▾"}
      </button>
      {showTable && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                <th className="text-left py-1.5 px-2">Month</th>
                <th className="text-right py-1.5 px-2">Gross revenue</th>
                <th className="text-right py-1.5 px-2">Total costs</th>
                <th className="text-right py-1.5 px-2">Net income</th>
              </tr>
            </thead>
            <tbody>
              {months.map((d) => (
                <tr key={d.month} className="border-t border-slate-100">
                  <td className="py-1.5 px-2 text-slate-700">{monthLabel(d.month)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmt(d.grossRevenue)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmt(d.totalCosts)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmt(d.netIncome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
