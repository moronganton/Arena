"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Plus, AlertTriangle, Check, Camera, ChevronRight, ChevronLeft, ChevronDown,
  ListChecks, BarChart3, RefreshCw, X,
} from "lucide-react";
import { FilterMenu, FilterSection, FilterList } from "@/components/ui/FilterMenu";

interface Property {
  id: string;
  name: string;
  city: string;
  active?: boolean;
}

interface CalReservation {
  id: string;
  checkIn: string;
  checkOut: string;
  status: string;
  source: string;
  guest: { name: string };
  property: { id: string; name: string; city: string };
}

interface ChecklistEntry {
  category: string;
  label: string;
  done: boolean;
}

interface PriorityJob {
  id: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checklist: ChecklistEntry[];
  property: { id: string; name: string; city: string };
  urgency: "URGENT" | "SOON" | "FLEXIBLE" | "SCHEDULED";
  reservation: { guestName: string; source: string; nights: number; checkOut: string } | null;
  damageCount: number;
}

interface PriorityDay {
  day: string;
  label: string;
  dayOffset: number; // 0 = today (server-decided; never recomputed here)
  dayWord: string;   // "today" | "tomorrow" | weekday name
  jobs: PriorityJob[];
}

interface DamageReport {
  id: string;
  description: string;
  photos?: string;
  status: string;
  createdAt: string;
  property: { id: string; name: string };
}

// --- Calendar geometry & helpers (same conventions as /calendar) ---
const DAY_W = 44;
const LABEL_W = 108;
const HEAD_H = 34;
const ROW_H = 40;
const WINDOW = 30;

const BAR_COLORS: Record<string, string> = {
  BOOKING: "bg-blue-600",
  AIRBNB: "bg-rose-600",
  VRBO: "bg-green-600",
  EXPEDIA: "bg-amber-500",
  DIRECT: "bg-violet-600",
};
const DOT_COLORS: Record<string, string> = {
  BOOKING: "#2563eb", AIRBNB: "#e11d48", VRBO: "#16a34a", EXPEDIA: "#f59e0b", DIRECT: "#7c3aed",
};
const SOURCE_LABELS: Record<string, string> = {
  BOOKING: "Booking.com", AIRBNB: "Airbnb", VRBO: "VRBO", EXPEDIA: "Expedia", DIRECT: "Direct",
};
const URGENCY_STYLE: Record<string, { pill: string; label: string }> = {
  URGENT: { pill: "bg-red-100 text-red-700", label: "Urgent" },
  SOON: { pill: "bg-amber-100 text-amber-700", label: "Soon" },
  FLEXIBLE: { pill: "bg-emerald-100 text-emerald-700", label: "Flexible" },
  SCHEDULED: { pill: "bg-slate-100 text-slate-500", label: "Scheduled" },
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayIndex(from: Date, date: Date) {
  return Math.round((startOfDay(date).getTime() - startOfDay(from).getTime()) / 86400000);
}
function placeBar(from: Date, start: Date, end: Date) {
  const s = Math.max(0, dayIndex(from, start));
  const e = Math.min(WINDOW, dayIndex(from, end));
  if (e <= 0 || s >= WINDOW || e <= s) return null;
  return { start: s, span: e - s };
}
// Compress a photo on the device before upload (max 1024px, JPEG 70%)
async function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = reject;
    img.src = url;
  });
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CleaningPage() {
  const today = startOfDay(new Date());
  const [windowStart, setWindowStart] = useState(() => addDays(startOfDay(new Date()), -2));
  const [properties, setProperties] = useState<Property[]>([]);
  const [calReservations, setCalReservations] = useState<CalReservation[]>([]);
  const [calLoading, setCalLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [priorityDays, setPriorityDays] = useState<PriorityDay[]>([]);
  const [priorityLoading, setPriorityLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [damageForm, setDamageForm] = useState<{ jobId: string; propertyId: string; desc: string; photos: string[] } | null>(null);
  // Real behavior is: a cleaning that isn't today's should be greyed out, so
  // a cleaner can't accidentally start tomorrow's job. Off by default; flip
  // it on to test Check-in/Damage/Check-out on a future-dated job.
  const [testMode, setTestMode] = useState(false);

  const [damages, setDamages] = useState<DamageReport[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ propertyId: "", scheduledDate: new Date().toISOString().slice(0, 10), notes: "" });
  // Empty = show every property, on both the calendar and the job list below it.
  const [visiblePropertyIds, setVisiblePropertyIds] = useState<string[]>([]);

  const windowEnd = addDays(windowStart, WINDOW);

  const loadCalendar = useCallback(async () => {
    setCalLoading(true);
    const [cal, props] = await Promise.all([
      fetch(`/api/calendar?from=${windowStart.toISOString()}&to=${windowEnd.toISOString()}`).then((r) => r.json()),
      fetch("/api/properties").then((r) => r.json()),
    ]);
    setCalReservations(cal.reservations || []);
    setProperties(Array.isArray(props) ? props.filter((p: Property) => p.active !== false) : []);
    setCalLoading(false);
    if (Array.isArray(props) && props.length > 0) {
      setForm((f) => ({ ...f, propertyId: f.propertyId || props[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  const loadPriority = useCallback(async () => {
    setPriorityLoading(true);
    const data = await fetch("/api/cleaning/priority?days=3").then((r) => r.json());
    setPriorityDays(Array.isArray(data) ? data : []);
    setPriorityLoading(false);
  }, []);

  const loadDamages = useCallback(async () => {
    const data = await fetch("/api/damages?status=OPEN").then((r) => r.json());
    setDamages(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);
  useEffect(() => { loadPriority(); loadDamages(); }, [loadPriority, loadDamages]);

  useEffect(() => {
    const todayIdx = dayIndex(windowStart, today);
    if (scrollRef.current && todayIdx > 2 && todayIdx < WINDOW) {
      scrollRef.current.scrollLeft = (todayIdx - 2) * DAY_W;
    } else if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calReservations, windowStart]);

  const visibleProperties = visiblePropertyIds.length > 0 ? properties.filter((p) => visiblePropertyIds.includes(p.id)) : properties;

  const resByProperty = new Map<string, CalReservation[]>();
  for (const r of calReservations) {
    if (r.status === "CANCELLED") continue;
    const arr = resByProperty.get(r.property.id) || [];
    arr.push(r);
    resByProperty.set(r.property.id, arr);
  }
  const days = Array.from({ length: WINDOW }, (_, i) => addDays(windowStart, i));

  // Same property filter applies to the job list below - re-derive day
  // groups from the filtered jobs so the "N jobs" counts stay correct.
  const visiblePriorityDays = visiblePropertyIds.length === 0
    ? priorityDays
    : priorityDays
        .map((d) => ({ ...d, jobs: d.jobs.filter((j) => visiblePropertyIds.includes(j.property.id)) }))
        .filter((d) => d.jobs.length > 0);

  async function handlePhotos(jobId: string, files: FileList | null, action: "checkin" | "checkout") {
    if (!files || files.length === 0) return;
    setBusyJob(jobId);
    try {
      const photos: string[] = [];
      for (const f of Array.from(files).slice(0, 5)) photos.push(await compressPhoto(f));
      const res = await fetch(`/api/cleaning/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, photos }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed");
      }
      await loadPriority();
    } finally {
      setBusyJob(null);
    }
  }

  async function toggleChecklistItem(job: PriorityJob, index: number) {
    const list = job.checklist.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    setPriorityDays((prev) =>
      prev.map((d) => ({ ...d, jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, checklist: list } : j)) }))
    );
    await fetch(`/api/cleaning/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklist: list }),
    });
  }

  async function addDamagePhotos(files: FileList | null) {
    if (!files || !damageForm) return;
    const next = [...damageForm.photos];
    for (const f of Array.from(files).slice(0, 5 - next.length)) next.push(await compressPhoto(f));
    setDamageForm({ ...damageForm, photos: next });
  }

  async function submitDamage() {
    if (!damageForm || !damageForm.desc.trim()) return;
    setBusyJob(damageForm.jobId);
    await fetch("/api/damages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: damageForm.propertyId,
        cleaningTaskId: damageForm.jobId,
        description: damageForm.desc,
        photos: damageForm.photos,
      }),
    });
    setBusyJob(null);
    setDamageForm(null);
    await loadPriority();
    await loadDamages();
  }

  async function createTask() {
    setCreating(true);
    const res = await fetch("/api/cleaning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setCreating(false);
    if (res.ok) {
      setShowForm(false);
      setForm((f) => ({ ...f, notes: "" }));
      await loadPriority();
    }
  }

  async function resolveDamage(id: string) {
    await fetch("/api/damages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "RESOLVED" }),
    });
    setDamages((prev) => prev.filter((d) => d.id !== id));
    await loadPriority();
  }

  const visibleTotalJobs = visiblePriorityDays.reduce((s, d) => s + d.jobs.length, 0);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-20">
      <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Cleaning</h1>
          <p className="text-slate-500 text-sm mt-0.5">Today's cleanings, ranked by priority</p>
        </div>
        <div className="flex gap-2">
          <Link href="/cleaning/report" className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2.5 rounded-xl text-sm font-medium transition">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Report</span>
          </Link>
          <Link href="/cleaning/checklists" className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2.5 rounded-xl text-sm font-medium transition">
            <ListChecks className="w-4 h-4" />
            <span className="hidden sm:inline">Checklists</span>
          </Link>
          <FilterMenu
            activeCount={visiblePropertyIds.length > 0 ? 1 : 0}
            onClear={() => setVisiblePropertyIds([])}
            onApply={() => {}}
          >
            <FilterSection label="Properties shown">
              <FilterList
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
                selected={visiblePropertyIds}
                onToggle={(v) => setVisiblePropertyIds((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
                onClearAll={() => setVisiblePropertyIds([])}
                allLabel="All Properties"
              />
            </FilterSection>
          </FilterMenu>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2.5 rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New</span>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">New Cleaning Task</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
              <select value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes for the cleaner (optional)</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Guest mentioned spilled wine on the sofa" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={createTask} disabled={creating || !form.propertyId} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition">
              {creating ? "Creating..." : "Create Task"}
            </button>
          </div>
        </div>
      )}

      {/* --- Calendar: natural height, capped at 50vh, then scrolls internally --- */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-5">
        <div className="flex items-center gap-2 p-3 border-b border-slate-100">
          <button onClick={() => setWindowStart((s) => addDays(s, -WINDOW))} className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition" aria-label="Previous">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setWindowStart((s) => addDays(s, WINDOW))} className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition" aria-label="Next">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setWindowStart(addDays(today, -2))} className="text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-lg transition">
            Today
          </button>
          <span className="text-sm font-semibold text-slate-800 ml-1">
            {windowStart.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
          </span>
          <span className="hidden sm:inline text-xs text-slate-400 ml-auto">↔ scroll for more dates</span>
        </div>

        {calLoading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading calendar…</div>
        ) : properties.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No properties yet</div>
        ) : visibleProperties.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No properties match the current filter</div>
        ) : (
          <div className="flex" style={{ maxHeight: "50vh", overflowY: "auto" }}>
            <div className="shrink-0 border-r border-slate-200 bg-white" style={{ width: LABEL_W }}>
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white flex items-center px-3 text-[9px] font-bold uppercase tracking-wide text-slate-400" style={{ height: HEAD_H }}>
                Property
              </div>
              {visibleProperties.map((p) => (
                <div key={`lab-${p.id}`} className="border-b border-slate-100 px-3 flex flex-col justify-center" style={{ height: ROW_H }}>
                  <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                  <p className="text-[9px] text-slate-400 truncate">{p.city}</p>
                </div>
              ))}
            </div>

            <div ref={scrollRef} className="overflow-x-auto flex-1">
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${WINDOW}, ${DAY_W}px)`, gridTemplateRows: `${HEAD_H}px repeat(${visibleProperties.length}, ${ROW_H}px)` }}>
                {days.map((d, i) => {
                  const isToday = dayIndex(today, d) === 0;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={i} className={`sticky top-0 z-10 border-b border-r border-slate-100 flex flex-col items-center justify-center ${isToday ? "bg-indigo-50" : isWeekend ? "bg-slate-50" : "bg-white"}`} style={{ gridRow: 1, gridColumn: i + 1 }}>
                      <span className="text-[8px] font-bold uppercase text-slate-400">{DOW[d.getDay()][0]}</span>
                      <span className={`text-xs font-bold ${isToday ? "text-indigo-600" : "text-slate-700"}`}>{d.getDate()}</span>
                    </div>
                  );
                })}
                {visibleProperties.map((p, r) =>
                  days.map((d, i) => {
                    const isToday = dayIndex(today, d) === 0;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    return <div key={`c-${p.id}-${i}`} className={`border-b border-r border-slate-50 ${isToday ? "bg-indigo-50/40" : isWeekend ? "bg-slate-50/50" : ""}`} style={{ gridRow: r + 2, gridColumn: i + 1 }} />;
                  })
                )}
                {visibleProperties.map((p, r) =>
                  (resByProperty.get(p.id) || []).map((res) => {
                    const pos = placeBar(windowStart, new Date(res.checkIn), new Date(res.checkOut));
                    if (!pos) return null;
                    return (
                      <div key={`res-${res.id}`} className={`z-[2] self-center h-8 rounded-md text-white shadow-sm flex items-center px-2 overflow-hidden ${BAR_COLORS[res.source] || "bg-slate-500"}`} style={{ gridRow: r + 2, gridColumn: `${pos.start + 1} / span ${pos.span}`, marginLeft: 2, marginRight: 2 }}>
                        <span className="text-[9px] font-bold leading-tight truncate">{res.guest.name}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 border-t border-slate-100">
          {Object.entries(SOURCE_LABELS).filter(([s]) => s !== "EXPEDIA").map(([s, label]) => (
            <span key={s} className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <i className="w-2.5 h-2.5 rounded" style={{ background: DOT_COLORS[s] }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* --- Priority job list --- */}
      <div className="flex items-center justify-between mb-2 px-0.5 gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Cleaning schedule</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTestMode((v) => !v)}
            className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full border transition ${
              testMode ? "bg-amber-50 border-amber-200 text-amber-700" : "border-slate-200 text-slate-400 hover:text-slate-600"
            }`}
            title="For testing only — unlocks tomorrow's and later jobs so their buttons can be tried before their actual day"
          >
            <span className={`w-2 h-2 rounded-full ${testMode ? "bg-amber-500" : "bg-slate-300"}`} />
            Test mode: {testMode ? "future jobs unlocked" : "off"}
          </button>
          <span className="text-xs text-slate-400">{visibleTotalJobs} job{visibleTotalJobs === 1 ? "" : "s"}</span>
        </div>
      </div>

      {priorityLoading ? (
        <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
      ) : priorityDays.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 py-10 text-center text-slate-400 text-sm">
          No check-outs in the next 3 days 🎉
        </div>
      ) : visiblePriorityDays.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 py-10 text-center text-slate-400 text-sm">
          No jobs match the current filter
        </div>
      ) : (
        visiblePriorityDays.map((group) => (
          <div key={group.day} className="mb-1">
            <div className="flex items-center gap-2 mt-3 mb-2 px-0.5">
              <span className={`text-[10px] font-bold uppercase tracking-wide ${group.dayOffset === 0 ? "text-indigo-600" : "text-slate-500"}`}>
                {group.label}
              </span>
              <span className="text-[10px] text-slate-400">{group.jobs.length} job{group.jobs.length === 1 ? "" : "s"}</span>
              <span className="flex-1 h-px bg-slate-200" />
            </div>
            {group.jobs.map((job) => {
              // Both come straight from the server's own day grouping - the
              // client must not recompute "is this today" from a timestamp.
              const isFuture = group.dayOffset > 0;
              const locked = isFuture && !testMode;
              const done = job.checklist.filter((c) => c.done).length;
              const total = job.checklist.length;
              const expanded = expandedJob === job.id;
              const showingDamageForm = damageForm?.jobId === job.id;
              const dayWord = group.dayWord;
              return (
                <div key={job.id} className={`bg-white rounded-2xl border mb-2 overflow-hidden ${job.urgency === "URGENT" && !locked ? "border-red-300 ring-1 ring-red-200" : "border-slate-100"} ${locked ? "opacity-60" : ""}`}>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5 cursor-pointer" onClick={() => setExpandedJob(expanded ? null : job.id)}>
                      <div className="flex items-start gap-1.5 min-w-0 flex-1">
                        <ChevronDown className={`w-3 h-3 text-slate-400 flex-shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-bold text-slate-900 truncate">{job.property.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {job.status === "COMPLETED"
                              ? `Completed ${job.checkOutAt ? new Date(job.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`
                              : job.status === "IN_PROGRESS"
                              ? `Check-out due ${dayWord} · in progress`
                              : `Check-out due ${dayWord}`}
                          </p>
                          {job.reservation && (
                            <div className="flex items-center gap-1 text-[9.5px] text-slate-500 mt-0.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: DOT_COLORS[job.reservation.source] || "#94a3b8" }} />
                              <span className="truncate">{job.reservation.guestName} · {job.reservation.nights}n · {SOURCE_LABELS[job.reservation.source] || job.reservation.source}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${URGENCY_STYLE[job.urgency].pill}`}>
                          {job.status === "COMPLETED" ? "Done" : URGENCY_STYLE[job.urgency].label}
                        </span>
                        {total > 0 && <span className="text-[9.5px] text-slate-400 font-semibold">{done}/{total}</span>}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <label className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9.5px] font-bold transition ${
                        locked ? "bg-slate-50 text-slate-300 cursor-not-allowed" : job.checkInAt ? "bg-green-50 text-green-700 cursor-pointer" : "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                      }`}>
                        {busyJob === job.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : job.checkInAt ? <Check className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                        {job.checkInAt ? "Checked in" : "Check-in"}
                        <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={!!job.checkInAt || locked} onChange={(e) => handlePhotos(job.id, e.target.files, "checkin")} />
                      </label>

                      <button
                        onClick={() => !locked && setDamageForm(showingDamageForm ? null : { jobId: job.id, propertyId: job.property.id, desc: "", photos: [] })}
                        disabled={locked}
                        className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9.5px] font-bold border transition ${locked ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Damage
                      </button>

                      <label className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9.5px] font-bold transition ${
                        locked ? "bg-slate-50 text-slate-300 cursor-not-allowed" : job.checkOutAt ? "bg-green-50 text-green-700 cursor-pointer" : job.checkInAt ? "bg-slate-900 text-white hover:bg-slate-800 cursor-pointer" : "bg-slate-50 text-slate-300 cursor-not-allowed"
                      }`}>
                        {busyJob === job.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : job.checkOutAt ? <Check className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                        {job.checkOutAt ? "Checked out" : "Check-out"}
                        <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={!job.checkInAt || !!job.checkOutAt || locked} onChange={(e) => handlePhotos(job.id, e.target.files, "checkout")} />
                      </label>
                    </div>
                  </div>

                  {showingDamageForm && (
                    <div className="border-t border-red-100 bg-red-50/40 p-3 space-y-2">
                      <textarea
                        value={damageForm!.desc}
                        onChange={(e) => setDamageForm({ ...damageForm!, desc: e.target.value })}
                        rows={2}
                        placeholder="Describe the problem… e.g. Broken table leg in living room"
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                      />
                      {damageForm!.photos.length > 0 && (
                        <div className="flex gap-1.5 overflow-x-auto">
                          {damageForm!.photos.map((p, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={p} alt="" className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <label className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition">
                          <Camera className="w-3.5 h-3.5" /> Add photo
                          <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addDamagePhotos(e.target.files)} />
                        </label>
                        <button onClick={submitDamage} disabled={!damageForm!.desc.trim() || busyJob === job.id} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
                          {busyJob === job.id ? "Sending…" : "Submit"}
                        </button>
                        <button onClick={() => setDamageForm(null)} className="border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-medium transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                      {job.checklist.length === 0 ? (
                        <p className="text-xs text-slate-400">No checklist on this task.</p>
                      ) : (
                        Array.from(new Set(job.checklist.map((c) => c.category))).map((cat) => (
                          <div key={cat} className="mb-2 last:mb-0">
                            <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">{cat}</p>
                            {job.checklist.map((item, i) =>
                              item.category === cat ? (
                                <button key={i} onClick={() => toggleChecklistItem(job, i)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs mb-1 transition ${item.done ? "text-slate-400 line-through" : "bg-white text-slate-700 hover:bg-slate-100"}`}>
                                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${item.done ? "bg-green-500 border-green-500" : "border-slate-300"}`}>
                                    {item.done && <Check className="w-2.5 h-2.5 text-white" />}
                                  </span>
                                  {item.label}
                                </button>
                              ) : null
                            )}
                          </div>
                        ))
                      )}
                      <Link href={`/cleaning/${job.id}`} className="text-xs text-indigo-600 hover:underline font-medium mt-1 inline-block">
                        Open full task →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      {/* Open damage reports across the portfolio (not just the next 3 days) */}
      {damages.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 p-4 mt-5">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            All Open Damage Reports ({damages.length})
          </h3>
          <div className="space-y-2">
            {damages.map((d) => {
              const photos: string[] = d.photos ? JSON.parse(d.photos) : [];
              return (
                <div key={d.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800">{d.description}</p>
                      <p className="text-xs text-slate-400 mt-1">{d.property.name} · {new Date(d.createdAt).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => resolveDamage(d.id)} className="flex items-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 px-2.5 py-1.5 rounded-lg font-medium transition flex-shrink-0">
                      <Check className="w-3.5 h-3.5" /> Resolved
                    </button>
                  </div>
                  {photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {photos.map((p, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={p} alt="damage" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
