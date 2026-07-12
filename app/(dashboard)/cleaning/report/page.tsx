"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, AlertTriangle, Check, ListChecks, Timer, Sparkles, MapPin } from "lucide-react";

interface ReportTask {
  id: string;
  property: { id: string; name: string; city: string };
  scheduledDate: string;
  status: string;
  notes?: string;
  checkInAt?: string;
  checkOutAt?: string;
  durationMinutes: number | null;
  checklistTotal: number;
  checklistDone: number;
  outstandingItems: string[];
  damageReports: { id: string; description: string; status: string; createdAt: string; photos: number }[];
}

interface OpenDamage {
  id: string;
  description: string;
  property: { id: string; name: string; city: string };
  createdAt: string;
  photos: number;
}

interface Report {
  days: number;
  summary: {
    totalTasks: number;
    completed: number;
    inProgress: number;
    pending: number;
    avgDurationMinutes: number | null;
    openDamages: number;
    tasksWithOutstandingItems: number;
  };
  openDamages: OpenDamage[];
  tasks: ReportTask[];
}

function fmtTime(d?: string) {
  return d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function fmtDuration(min: number | null) {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export default function CleaningReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetch(`/api/cleaning/report?days=${days}`)
      .then((r) => r.json())
      .then(setReport);
  }, [days]);

  if (!report) return <div className="p-8 text-center text-slate-400 text-sm">Loading report...</div>;

  const cities = Array.from(new Set(report.tasks.map((t) => t.property.city)));

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <Link href="/cleaning" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Cleaning
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Cleaning Report</h1>
          <p className="text-slate-500 text-sm mt-0.5">Durations, outstanding items and damages</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-2xl font-bold text-slate-900">{report.summary.completed}<span className="text-sm font-normal text-slate-400">/{report.summary.totalTasks}</span></p>
          <p className="text-xs text-slate-500 mt-0.5">Cleanings completed</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-2xl font-bold text-slate-900">{fmtDuration(report.summary.avgDurationMinutes)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Avg. cleaning time</p>
        </div>
        <div className={`rounded-2xl border p-4 ${report.summary.openDamages > 0 ? "bg-red-50 border-red-200" : "bg-white border-slate-100"}`}>
          <p className={`text-2xl font-bold ${report.summary.openDamages > 0 ? "text-red-600" : "text-slate-900"}`}>{report.summary.openDamages}</p>
          <p className="text-xs text-slate-500 mt-0.5">Open damages</p>
        </div>
        <div className={`rounded-2xl border p-4 ${report.summary.tasksWithOutstandingItems > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-100"}`}>
          <p className={`text-2xl font-bold ${report.summary.tasksWithOutstandingItems > 0 ? "text-amber-600" : "text-slate-900"}`}>{report.summary.tasksWithOutstandingItems}</p>
          <p className="text-xs text-slate-500 mt-0.5">Completed with skipped items</p>
        </div>
      </div>

      {/* Action required: open damages */}
      {report.openDamages.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-200 p-5 mb-6">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Action Required — Open Damages ({report.openDamages.length})
          </h3>
          <div className="space-y-2">
            {report.openDamages.map((d) => (
              <div key={d.id} className="flex items-center justify-between border border-red-100 bg-red-50/40 rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">{d.description}</p>
                  <p className="text-xs text-slate-500">
                    {d.property.name} ({d.property.city}) · reported {new Date(d.createdAt).toLocaleDateString()}
                    {d.photos > 0 ? ` · ${d.photos} photo${d.photos > 1 ? "s" : ""}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Resolve reports from the Cleaning page once your technical/purchasing team has handled them.
          </p>
        </div>
      )}

      {/* Per-city task details */}
      {cities.map((city) => (
        <div key={city} className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-slate-800">{city}</h3>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
            {report.tasks.filter((t) => t.property.city === city).map((t) => (
              <div key={t.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Link href={`/cleaning/${t.id}`} className="font-medium text-slate-900 text-sm hover:text-indigo-600 transition">
                    {t.property.name}
                  </Link>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    t.status === "COMPLETED" ? "bg-green-100 text-green-700"
                    : t.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                  }`}>
                    {t.status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>{new Date(t.scheduledDate).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {fmtTime(t.checkInAt)} → {fmtTime(t.checkOutAt)}
                  </span>
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Timer className="w-3.5 h-3.5" />
                    {fmtDuration(t.durationMinutes)}
                  </span>
                  <span className="flex items-center gap-1">
                    <ListChecks className="w-3.5 h-3.5" />
                    {t.checklistDone}/{t.checklistTotal} done
                  </span>
                </div>

                {t.notes && (
                  <p className="text-xs text-slate-500 mt-2 bg-slate-50 rounded-lg px-3 py-1.5">
                    📝 {t.notes}
                  </p>
                )}

                {t.outstandingItems.length > 0 && t.status === "COMPLETED" && (
                  <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Not completed ({t.outstandingItems.length}):</p>
                    <ul className="text-xs text-amber-700 space-y-0.5">
                      {t.outstandingItems.map((o, i) => (
                        <li key={i}>• {o}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {t.damageReports.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {t.damageReports.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-xs">
                        {d.status === "OPEN" ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        )}
                        <span className="text-slate-700">{d.description}</span>
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                          d.status === "OPEN" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        }`}>
                          {d.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {report.tasks.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 text-center py-16">
          <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No cleaning tasks in this period</p>
        </div>
      )}
    </div>
  );
}
