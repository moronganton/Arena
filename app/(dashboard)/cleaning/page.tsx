"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Sparkles, AlertTriangle, Check, Camera, ChevronRight, MapPin, CalendarClock, ListChecks, BarChart3 } from "lucide-react";

interface Property {
  id: string;
  name: string;
}

interface CleaningTask {
  id: string;
  status: string;
  scheduledDate: string;
  checkInAt?: string;
  checkOutAt?: string;
  notes?: string;
  property: { id: string; name: string; city: string };
  _count: { damageReports: number };
}

interface DamageReport {
  id: string;
  description: string;
  photos?: string;
  status: string;
  createdAt: string;
  property: { id: string; name: string };
}

interface Checkout {
  reservationId: string;
  guestName: string;
  checkOut: string;
  nextCheckIn: string | null;
  urgency: "URGENT" | "SOON" | "FLEXIBLE";
  property: { id: string; name: string; address: string; city: string; country: string };
  cleaningTask: { id: string; status: string } | null;
}

// Rough driving times between known cities; same-city hops default to 15 min.
const CITY_TRAVEL_HOURS: Record<string, number> = {
  "bratislava|prague": 3.5,
  "bratislava|oradea": 5.5,
  "oradea|prague": 7.5,
  "oradea|sinteu": 0.8,
  "bratislava|sinteu": 5,
  "prague|sinteu": 7.5,
};

function travelEstimate(a: Checkout, b: Checkout): string {
  if (a.property.id === b.property.id) return "same building";
  const cityA = a.property.city.trim().toLowerCase();
  const cityB = b.property.city.trim().toLowerCase();
  if (cityA === cityB) {
    return a.property.address === b.property.address ? "same street" : "~15 min drive";
  }
  const key = [cityA, cityB].sort().join("|");
  const hours = CITY_TRAVEL_HOURS[key];
  if (hours) {
    return hours < 1 ? `~${Math.round(hours * 60)} min drive` : `~${hours} h drive`;
  }
  return "long trip — different city";
}

const URGENCY_STYLE: Record<string, { badge: string; label: string }> = {
  URGENT: { badge: "bg-red-100 text-red-700", label: "URGENT — same-day check-in" },
  SOON: { badge: "bg-amber-100 text-amber-700", label: "Guest arrives tomorrow" },
  FLEXIBLE: { badge: "bg-green-100 text-green-700", label: "Flexible — no arrival soon" },
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
};

export default function CleaningPage() {
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [damages, setDamages] = useState<DamageReport[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [checkouts, setCheckouts] = useState<Checkout[]>([]);
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    propertyId: "",
    scheduledDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const loadData = useCallback(async () => {
    const [taskData, damageData, props] = await Promise.all([
      fetch("/api/cleaning").then((r) => r.json()),
      fetch("/api/damages?status=OPEN").then((r) => r.json()),
      fetch("/api/properties").then((r) => r.json()),
    ]);
    setTasks(Array.isArray(taskData) ? taskData : []);
    setDamages(Array.isArray(damageData) ? damageData : []);
    setProperties(Array.isArray(props) ? props : []);
    if (props.length > 0) setForm((f) => ({ ...f, propertyId: f.propertyId || props[0].id }));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    fetch(`/api/cleaning/checkouts?day=${day}`)
      .then((r) => r.json())
      .then((d) => setCheckouts(Array.isArray(d) ? d : []));
  }, [day]);

  async function createTaskForCheckout(c: Checkout) {
    setCreatingFor(c.reservationId);
    const res = await fetch("/api/cleaning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: c.property.id,
        reservationId: c.reservationId,
        scheduledDate: c.checkOut,
        notes: `After check-out of ${c.guestName}`,
      }),
    });
    setCreatingFor(null);
    if (res.ok) {
      const task = await res.json();
      setCheckouts((prev) =>
        prev.map((x) =>
          x.reservationId === c.reservationId
            ? { ...x, cleaningTask: { id: task.id, status: task.status } }
            : x
        )
      );
      await loadData();
    }
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
      await loadData();
    }
  }

  async function resolveDamage(id: string) {
    await fetch("/api/damages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "RESOLVED" }),
    });
    setDamages((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Cleaning</h1>
          <p className="text-slate-500 text-sm mt-0.5">Housekeeping tasks and damage reports</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/cleaning/report"
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Report</span>
          </Link>
          <Link
            href="/cleaning/checklists"
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <ListChecks className="w-4 h-4" />
            <span className="hidden sm:inline">Checklists</span>
          </Link>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">New Cleaning Task</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
              <select
                value={form.propertyId}
                onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes for the cleaner (optional)</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Guest mentioned spilled wine on the sofa"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={createTask}
              disabled={creating || !form.propertyId}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {creating ? "Creating..." : "Create Task"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Check-outs to clean */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-slate-500" />
            Check-outs to Clean
          </h3>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setDay("today")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                day === "today" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDay("tomorrow")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                day === "tomorrow" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Tomorrow
            </button>
          </div>
        </div>

        {checkouts.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            No check-outs {day === "today" ? "today" : "tomorrow"} 🎉
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-3">
              Grouped by city — one list per cleaning team, ordered to minimize travel.
            </p>
            {Array.from(new Set(checkouts.map((c) => c.property.city))).map((city) => {
              const cityCheckouts = checkouts.filter((c) => c.property.city === city);
              return (
            <div key={city} className="mb-5 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-indigo-500" />
                <h4 className="font-semibold text-slate-800 text-sm">{city}</h4>
                <span className="text-xs text-slate-400">
                  {cityCheckouts.length} cleaning{cityCheckouts.length > 1 ? "s" : ""} · {cityCheckouts.filter((c) => c.urgency === "URGENT").length} urgent
                </span>
              </div>
            <div className="space-y-0">
              {cityCheckouts.map((c, i) => (
                <div key={c.reservationId}>
                  {/* Travel time from the previous stop */}
                  {i > 0 && (
                    <div className="flex items-center gap-2 py-1.5 pl-10">
                      <span className="text-xs text-slate-400">🚗 {travelEstimate(cityCheckouts[i - 1], c)}</span>
                    </div>
                  )}
                  <div className={`border rounded-xl p-3 ${
                    c.urgency === "URGENT" ? "border-red-200 bg-red-50/40" : "border-slate-100"
                  }`}>
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-slate-900 text-sm truncate">{c.property.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${URGENCY_STYLE[c.urgency].badge}`}>
                            {URGENCY_STYLE[c.urgency].label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {c.property.address}, {c.property.city}
                        </p>
                        <p className="text-xs text-slate-400">
                          {c.guestName} leaves by 11:00
                          {c.nextCheckIn && (
                            <>
                              {" · next guest "}
                              {new Date(c.nextCheckIn).toDateString() === new Date(c.checkOut).toDateString()
                                ? "TODAY at 15:00"
                                : `${new Date(c.nextCheckIn).toLocaleDateString(undefined, { month: "short", day: "numeric" })} at 15:00`}
                            </>
                          )}
                        </p>
                      </div>
                      {c.cleaningTask ? (
                        <Link
                          href={`/cleaning/${c.cleaningTask.id}`}
                          className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium transition flex-shrink-0 ${
                            c.cleaningTask.status === "COMPLETED"
                              ? "bg-green-50 text-green-700"
                              : c.cleaningTask.status === "IN_PROGRESS"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {c.cleaningTask.status === "COMPLETED" ? (
                            <><Check className="w-3.5 h-3.5" /> Done</>
                          ) : (
                            <>{c.cleaningTask.status === "IN_PROGRESS" ? "In progress" : "Open task"} <ChevronRight className="w-3.5 h-3.5" /></>
                          )}
                        </Link>
                      ) : (
                        <button
                          onClick={() => createTaskForCheckout(c)}
                          disabled={creatingFor === c.reservationId}
                          className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg font-medium transition flex-shrink-0"
                        >
                          {creatingFor === c.reservationId ? "Creating..." : "Create task"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </div>
              );
            })}
          </>
        )}
      </div>

      {/* Open damage reports */}
      {damages.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 p-5 mb-6">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Open Damage Reports ({damages.length})
          </h3>
          <div className="space-y-3">
            {damages.map((d) => {
              const photos: string[] = d.photos ? JSON.parse(d.photos) : [];
              return (
                <div key={d.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800">{d.description}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {d.property.name} · {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => resolveDamage(d.id)}
                      className="flex items-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 px-2.5 py-1.5 rounded-lg font-medium transition flex-shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Resolved
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

      {/* Task list */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="text-center py-16">
            <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No cleaning tasks yet</p>
            <p className="text-slate-400 text-xs mt-1">Create one for the next check-out</p>
          </div>
        ) : (
          <div>
            {Array.from(new Set(tasks.map((t) => t.property.city))).map((city) => (
              <div key={city}>
                <div className="flex items-center gap-2 px-4 md:px-5 pt-4 pb-1">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                  <h4 className="font-semibold text-slate-700 text-xs uppercase tracking-wide">{city}</h4>
                </div>
                <div className="divide-y divide-slate-50">
                  {tasks.filter((t) => t.property.city === city).map((t) => (
                    <Link
                      key={t.id}
                      href={`/cleaning/${t.id}`}
                      className="flex items-center justify-between p-4 md:p-5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-5 h-5 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{t.property.name}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(t.scheduledDate).toLocaleDateString()}
                            {t.notes ? ` · ${t.notes.slice(0, 40)}${t.notes.length > 40 ? "…" : ""}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {t._count.damageReports > 0 && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {t._count.damageReports}
                          </span>
                        )}
                        {(t.checkInAt || t.checkOutAt) && (
                          <Camera className="w-4 h-4 text-slate-400" />
                        )}
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[t.status] || "bg-slate-100 text-slate-600"}`}>
                          {t.status.replace("_", " ")}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
