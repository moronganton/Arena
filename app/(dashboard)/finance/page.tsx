"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, Camera,
  RefreshCw, Sparkles, X, Receipt,
} from "lucide-react";

const CATEGORIES = [
  "CLEANING", "LAUNDRY", "PLATFORM_FEES", "ESSENTIALS",
  "DAMAGES", "INSURANCE", "UTILITIES", "MAINTENANCE", "OTHER",
];

const CATEGORY_LABELS: Record<string, string> = {
  CLEANING: "Cleaning", LAUNDRY: "Laundry", PLATFORM_FEES: "Platform Fees",
  ESSENTIALS: "Essentials", DAMAGES: "Damages", INSURANCE: "Insurance",
  UTILITIES: "Utilities", MAINTENANCE: "Maintenance", OTHER: "Other",
};

const SOURCE_LABELS: Record<string, string> = {
  BOOKING: "Booking.com", AIRBNB: "Airbnb", VRBO: "VRBO", EXPEDIA: "Expedia", DIRECT: "Direct",
};

interface Property { id: string; name: string }

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  aiExtracted: boolean;
  invoiceImage?: string;
  property?: { id: string; name: string } | null;
}

interface PerReservationCost {
  id: string;
  category: string;
  description: string;
  amount: number;      // cost for ONE reservation
  currency: string;
  property: { id: string; name: string } | null;
  reservations: number; // check-outs counted this month
  total: number;        // amount x reservations
}

interface RecurringCost {
  id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  property?: { id: string; name: string } | null;
}

interface Report {
  month: string;
  summary: { grossRevenue: number; totalCosts: number; netIncome: number; margin: number | null; reservations: number };
  revenueBySource: Record<string, number>;
  costsByCategory: Record<string, number>;
  platformFees: Array<{ channel: string; percent: number; base: number; fee: number }>;
  recurringCosts: RecurringCost[];
  perReservationCosts: PerReservationCost[];
  properties: Array<{
    id: string; name: string; city: string; currency: string;
    revenue: number; costs: number; net: number; margin: number | null; reservationCount: number;
  }>;
}

async function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = url;
  });
}

const emptyForm = {
  category: "ESSENTIALS",
  description: "",
  amount: "",
  currency: "EUR",
  date: new Date().toISOString().slice(0, 10),
  propertyId: "",
  invoiceImage: "",
  aiExtracted: false,
  // "once" = a single dated expense, "monthly" = same amount every month,
  // "perReservation" = amount x however many bookings the month has.
  kind: "once" as "once" | "monthly" | "perReservation",
};

const FEE_CHANNELS = ["BOOKING", "AIRBNB", "VRBO", "EXPEDIA"];

export default function FinancePage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [propertyFilter, setPropertyFilter] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extractNote, setExtractNote] = useState("");
  const [feeSettings, setFeeSettings] = useState<Record<string, string>>({});
  const [savingFees, setSavingFees] = useState(false);
  const [showFeeSettings, setShowFeeSettings] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<Expense | null>(null);

  const loadData = useCallback(async () => {
    const propertyQuery = propertyFilter ? `&propertyId=${propertyFilter}` : "";
    const [rep, exp, props, fees] = await Promise.all([
      fetch(`/api/finance/report?month=${month}${propertyQuery}`).then((r) => r.json()),
      fetch(`/api/expenses?month=${month}${propertyQuery}`).then((r) => r.json()),
      fetch("/api/properties").then((r) => r.json()),
      fetch("/api/platform-fees").then((r) => r.json()),
    ]);
    setReport(rep);
    setExpenses(Array.isArray(exp) ? exp : []);
    setProperties(Array.isArray(props) ? props : []);
    if (Array.isArray(fees)) {
      const map: Record<string, string> = {};
      for (const f of fees) map[f.channel] = String(f.percent);
      setFeeSettings(map);
    }
  }, [month, propertyFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function uploadInvoice(files: FileList | null) {
    if (!files || files.length === 0) return;
    setExtracting(true);
    setExtractNote("");
    try {
      const image = await compressPhoto(files[0]);
      const res = await fetch("/api/expenses/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExtractNote(data.error || "Extraction failed — fill in manually.");
        setForm({ ...emptyForm, invoiceImage: image });
      } else {
        setForm({
          category: data.category || "OTHER",
          description: data.description || "",
          amount: data.amount != null ? String(data.amount) : "",
          currency: data.currency || "EUR",
          date: data.date || new Date().toISOString().slice(0, 10),
          propertyId: data.propertyId || "",
          invoiceImage: image,
          aiExtracted: true,
          kind: "once" as const,
        });
        setExtractNote(
          `AI extracted with ${Math.round((data.confidence || 0.5) * 100)}% confidence — please verify before saving.`
        );
      }
      setShowForm(true);
    } finally {
      setExtracting(false);
    }
  }

  async function saveExpense() {
    setSaving(true);
    const endpoint =
      form.kind === "monthly"
        ? "/api/recurring-expenses"
        : form.kind === "perReservation"
        ? "/api/per-reservation-costs"
        : "/api/expenses";
    const payload =
      form.kind === "once" ? form : { ...form, startMonth: month };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setShowForm(false);
      setForm(emptyForm);
      setExtractNote("");
      await loadData();
    }
  }

  async function deleteExpense(id: string) {
    await fetch(`/api/expenses?id=${id}`, { method: "DELETE" });
    await loadData();
  }

  async function modifyRecurring(r: RecurringCost) {
    const input = prompt(
      `New monthly amount for "${r.description}" (effective from ${month}):`,
      String(r.amount)
    );
    if (input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount < 0) return alert("Invalid amount");
    await fetch("/api/recurring-expenses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, amount, effectiveMonth: month }),
    });
    await loadData();
  }

  async function endRecurring(r: RecurringCost) {
    if (!confirm(`Stop "${r.description}" from ${month} onward? Past months keep it.`)) return;
    await fetch(`/api/recurring-expenses?id=${r.id}&month=${month}`, { method: "DELETE" });
    await loadData();
  }

  async function modifyPerReservation(r: PerReservationCost) {
    const input = prompt(
      `New cost per reservation for "${r.description}" (effective from ${month}):`,
      String(r.amount)
    );
    if (input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount < 0) return alert("Invalid amount");
    await fetch("/api/per-reservation-costs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, amount, effectiveMonth: month }),
    });
    await loadData();
  }

  async function endPerReservation(r: PerReservationCost) {
    if (!confirm(`Stop "${r.description}" from ${month} onward? Past months keep it.`)) return;
    await fetch(`/api/per-reservation-costs?id=${r.id}&month=${month}`, { method: "DELETE" });
    await loadData();
  }

  async function saveFeeSettings() {
    setSavingFees(true);
    await fetch("/api/platform-fees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fees: FEE_CHANNELS.map((c) => ({ channel: c, percent: parseFloat(feeSettings[c] || "0") || 0 })),
      }),
    });
    setSavingFees(false);
    setShowFeeSettings(false);
    await loadData();
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const maxCategoryCost = report ? Math.max(1, ...Object.values(report.costsByCategory)) : 1;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Finance</h1>
          <p className="text-slate-500 text-sm mt-0.5">Revenue, costs and net income per property</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer">
            {extracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            <span className="hidden sm:inline">{extracting ? "Reading invoice..." : "Upload Invoice"}</span>
            <input
              type="file" accept="image/*" className="hidden"
              onChange={(e) => uploadInvoice(e.target.files)}
              disabled={extracting}
            />
          </label>
          <button
            onClick={() => { setForm({ ...emptyForm, propertyId: propertyFilter }); setExtractNote(""); setShowForm(true); }}
            className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Cost</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      {report && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <TrendingUp className="w-3.5 h-3.5" /> GROSS REVENUE
              </div>
              <p className="text-2xl font-bold text-slate-900">{fmt(report.summary.grossRevenue)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{report.summary.reservations} reservations checked out</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <TrendingDown className="w-3.5 h-3.5" /> TOTAL COSTS
              </div>
              <p className="text-2xl font-bold text-slate-900">{fmt(report.summary.totalCosts)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{expenses.length} expense entries</p>
            </div>
            <div className={`rounded-2xl border p-5 ${report.summary.netIncome >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <Wallet className="w-3.5 h-3.5" /> NET INCOME
              </div>
              <p className={`text-2xl font-bold ${report.summary.netIncome >= 0 ? "text-green-700" : "text-red-700"}`}>
                {fmt(report.summary.netIncome)}
              </p>
              {report.summary.margin !== null && (
                <p className="text-xs text-slate-500 mt-0.5">{report.summary.margin}% margin</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Revenue by source */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="font-semibold text-slate-900 text-sm mb-3">Revenue by Channel</h3>
              {Object.keys(report.revenueBySource).length === 0 ? (
                <p className="text-xs text-slate-400">No revenue this month</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(report.revenueBySource).sort((a, b) => b[1] - a[1]).map(([src, amt]) => (
                    <div key={src} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{SOURCE_LABELS[src] || src}</span>
                      <span className="font-medium text-slate-900">{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Costs by category */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <h3 className="font-semibold text-slate-900 text-sm mb-3">Costs by Category</h3>
              {Object.keys(report.costsByCategory).length === 0 ? (
                <p className="text-xs text-slate-400">No costs recorded this month</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(report.costsByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-sm mb-0.5">
                        <span className="text-slate-600">{CATEGORY_LABELS[cat] || cat}</span>
                        <span className="font-medium text-slate-900">{fmt(amt)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(amt / maxCategoryCost) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per property */}
          <div className="mb-6">
            <h3 className="font-semibold text-slate-900 text-sm mb-3 md:hidden">Per Property</h3>

            {/* Mobile cards — every figure gets its own line, nothing cropped */}
            <div className="md:hidden space-y-3">
              {report.properties.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 text-center text-slate-400 py-8 text-sm">
                  No activity this month
                </div>
              )}
              {report.properties.map((p) => (
                <div key={p.id} className="bg-white rounded-2xl border border-slate-100 p-4">
                  <p className="font-medium text-slate-900 text-sm">{p.name}</p>
                  <p className="text-xs text-slate-400 mb-2">{p.city} · {p.reservationCount} stays</p>
                  <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <dt className="text-slate-500">Revenue</dt>
                    <dd className="text-right text-slate-700">{fmt(p.revenue)} {p.currency}</dd>
                    <dt className="text-slate-500">Costs</dt>
                    <dd className="text-right text-slate-700">{fmt(p.costs)} {p.currency}</dd>
                    <dt className="text-slate-500">Net</dt>
                    <dd className={`text-right font-semibold ${p.net >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmt(p.net)} {p.currency}
                    </dd>
                    <dt className="text-slate-500">Margin</dt>
                    <dd className="text-right text-slate-500">{p.margin !== null ? `${p.margin}%` : "—"}</dd>
                  </dl>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900 text-sm">Per Property</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase">
                      <th className="text-left px-5 py-3">Property</th>
                      <th className="text-right px-5 py-3">Revenue</th>
                      <th className="text-right px-5 py-3">Costs</th>
                      <th className="text-right px-5 py-3">Net</th>
                      <th className="text-right px-5 py-3">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.properties.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-slate-400 py-8">No activity this month</td></tr>
                    )}
                    {report.properties.map((p) => (
                      <tr key={p.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.city} · {p.reservationCount} stays</p>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{fmt(p.revenue)} {p.currency}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{fmt(p.costs)} {p.currency}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${p.net >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {fmt(p.net)} {p.currency}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500">
                          {p.margin !== null ? `${p.margin}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Expense form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full my-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-900">
                {form.aiExtracted ? "Confirm Extracted Cost" : "Add Cost"}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {extractNote && (
              <p className="text-xs bg-indigo-50 text-indigo-700 rounded-lg px-3 py-2 mb-3 flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                {extractNote}
              </p>
            )}

            {form.invoiceImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.invoiceImage} alt="invoice" className="w-full max-h-40 object-contain bg-slate-50 rounded-xl mb-3" />
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Property</label>
                <select
                  value={form.propertyId}
                  onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All properties (general)</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Amount</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {["EUR", "RON", "CZK", "USD", "GBP", "CHF"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {form.kind === "once" && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
              <div className="col-span-2 bg-slate-50 rounded-xl p-3">
                <label className="block text-xs font-medium text-slate-500 mb-2">How is this cost incurred?</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["once", "One-off"],
                    ["monthly", "Every month"],
                    ["perReservation", "Per reservation"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm({ ...form, kind: value })}
                      className={`text-xs font-medium px-2 py-2 rounded-lg border transition ${
                        form.kind === value
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {form.kind === "monthly"
                    ? `The same amount every month from ${month} (electricity, internet, building fees). You can change or stop it later.`
                    : form.kind === "perReservation"
                    ? `Charged once per booking from ${month}. Enter the cost for ONE reservation — the month's total is worked out from the number of check-outs and updates itself as bookings change.`
                    : "A single cost on the date above (a repair, a yearly insurance bill)."}
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={saveExpense}
                disabled={saving || !form.description || !form.amount}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition"
              >
                {saving ? "Saving..." : "Save Cost"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform fees (auto) */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-slate-900 text-sm">Platform Fees (automatic)</h3>
          <button
            onClick={() => setShowFeeSettings(!showFeeSettings)}
            className="text-xs text-indigo-600 hover:underline"
          >
            {showFeeSettings ? "Close" : "Set commission %"}
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Calculated automatically as a percentage of each channel&apos;s revenue this month.
        </p>

        {showFeeSettings && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FEE_CHANNELS.map((c) => (
                <div key={c}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{SOURCE_LABELS[c]}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min="0" max="50" step="0.1"
                      value={feeSettings[c] || ""}
                      onChange={(e) => setFeeSettings({ ...feeSettings, [c]: e.target.value })}
                      placeholder="e.g. 15"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-500">%</span>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={saveFeeSettings}
              disabled={savingFees}
              className="mt-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition"
            >
              {savingFees ? "Saving..." : "Save percentages"}
            </button>
          </div>
        )}

        {report && report.platformFees.length > 0 ? (
          <div className="space-y-1.5">
            {report.platformFees.map((f) => (
              <div key={f.channel} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-600">
                  {SOURCE_LABELS[f.channel] || f.channel} · {f.percent}% of {fmt(f.base)}
                </span>
                <span className="font-semibold text-slate-900">{fmt(f.fee)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            {Object.values(feeSettings).some((v) => parseFloat(v) > 0)
              ? "No channel revenue this month."
              : "No commission percentages set — click \"Set commission %\" to enable automatic fees."}
          </p>
        )}
      </div>

      {/* Recurring monthly costs */}
      {report && report.recurringCosts.length > 0 && (
        <div className="bg-white rounded-2xl border border-indigo-200 p-5 mb-4">
          <h3 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
            Recurring Monthly Costs
          </h3>
          <p className="text-xs text-slate-400 mb-3">
            Applied automatically every month. Modify when a price changes — history stays intact.
          </p>
          <div className="space-y-1.5">
            {report.recurringCosts.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-indigo-50/50 border border-indigo-100 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{r.description}</p>
                  <p className="text-xs text-slate-500">
                    {CATEGORY_LABELS[r.category]} · {r.property?.name || "General"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-900">{r.amount.toLocaleString()} {r.currency}/mo</span>
                  <button
                    onClick={() => modifyRecurring(r)}
                    className="text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded-lg transition"
                  >
                    Modify
                  </button>
                  <button
                    onClick={() => endRecurring(r)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-reservation costs */}
      {report && report.perReservationCosts.length > 0 && (
        <div className="bg-white rounded-2xl border border-emerald-200 p-5 mb-4">
          <h3 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
            Per-Reservation Costs
          </h3>
          <p className="text-xs text-slate-400 mb-3">
            Recalculated from the number of check-outs in {month} — the total moves on its own as bookings are added or cancelled.
          </p>
          <div className="space-y-1.5">
            {report.perReservationCosts.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{r.description}</p>
                  <p className="text-xs text-slate-500">
                    {CATEGORY_LABELS[r.category]} · {r.property?.name || "All properties"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {r.amount.toLocaleString()} {r.currency} × {r.reservations} reservation{r.reservations === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-900">
                    {r.total.toLocaleString()} {r.currency}
                  </span>
                  <button
                    onClick={() => modifyPerReservation(r)}
                    className="text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded-lg transition"
                  >
                    Modify
                  </button>
                  <button
                    onClick={() => endPerReservation(r)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expense list */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">One-off Costs in {month}</h3>
        </div>
        {expenses.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">No one-off costs recorded this month</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900 truncate">{e.description}</p>
                    {e.aiExtracted && <Sparkles className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {CATEGORY_LABELS[e.category]} · {e.property?.name || "General"} · {new Date(e.date).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-900">
                    {e.amount.toLocaleString()} {e.currency}
                  </span>
                  {e.invoiceImage && (
                    <button
                      onClick={() => setViewingInvoice(e)}
                      title="View invoice"
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    >
                      <Receipt className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteExpense(e.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoice viewer */}
      {viewingInvoice && viewingInvoice.invoiceImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setViewingInvoice(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">{viewingInvoice.description}</p>
                <p className="text-xs text-slate-500">
                  {viewingInvoice.amount.toLocaleString()} {viewingInvoice.currency} ·{" "}
                  {new Date(viewingInvoice.date).toLocaleDateString()} ·{" "}
                  {viewingInvoice.property?.name || "General"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={viewingInvoice.invoiceImage}
                  download={`invoice-${new Date(viewingInvoice.date).toISOString().slice(0, 10)}.jpg`}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition"
                >
                  Download
                </a>
                <button
                  onClick={() => setViewingInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewingInvoice.invoiceImage} alt="Invoice" className="w-full rounded-xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
