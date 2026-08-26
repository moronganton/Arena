"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil, DollarSign, CalendarDays, X } from "lucide-react";

interface Property {
  id: string;
  name: string;
  currency: string;
  basePrice: number;
}

interface PricingRule {
  id: string;
  name: string;
  ruleType: string;
  price?: number;
  adjustment?: number;
  adjType?: string;
  startDate?: string;
  endDate?: string;
  daysOfWeek?: string;
  minNights?: number;
  priority: number;
  active: boolean;
  property: { id: string; name: string; currency: string };
}

// A rule's currency comes from its property relation, which is not
// guaranteed to be present on every code path that puts a rule into state.
// Reading it directly took the whole page down once already, so it degrades
// to the selected property's currency and then to nothing.
function ruleCurrency(rule: PricingRule, fallback?: string): string {
  return rule.property?.currency ?? fallback ?? "";
}

const RULE_TYPE_LABELS: Record<string, string> = {
  BASE: "Base Price",
  WEEKEND: "Weekend Rate",
  SEASONAL: "Seasonal Rate",
  LAST_MINUTE: "Last Minute",
  MINIMUM_STAY: "Min. Stay",
};

export default function PricingPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [_loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const blankForm = {
    name: "",
    ruleType: "SEASONAL",
    startDate: "",
    endDate: "",
    price: "",
    adjustment: "",
    adjType: "PERCENT",
    minNights: "1",
    // Ties are resolved newest-first, so leaving this at 0 is workable for a
    // handful of rules and stops being workable the moment two of them overlap
    // and you care which wins.
    priority: "0",
    daysOfWeek: [] as number[],
    active: true,
  };
  const [form, setForm] = useState(blankForm);

  // Both of these render straight into .map/.find, so a non-array response -
  // an auth failure or a 500 returning {error} - would crash the page rather
  // than show it empty. Normalising here keeps a bad response visible as "no
  // rules" instead of a white screen.
  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setProperties(list);
        if (list.length > 0) setSelectedProperty(list[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    fetch(`/api/pricing?propertyId=${selectedProperty}`)
      .then((r) => r.json())
      .then((data) => setRules(Array.isArray(data) ? data : []))
      .catch(() => setRules([]));
  }, [selectedProperty]);

  function openNew() {
    setEditingId(null);
    setForm(blankForm);
    setSaveError(null);
    setShowForm(true);
  }

  // Prefills the same form used to create a rule, so editing is "open the
  // rule's own values, change what's wrong, save" rather than a second form
  // with a different shape. daysOfWeek comes back from the API as a JSON
  // string ("[5,6]"); everything else is already the right primitive type.
  function openEdit(rule: PricingRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      ruleType: rule.ruleType,
      startDate: rule.startDate ? rule.startDate.slice(0, 10) : "",
      endDate: rule.endDate ? rule.endDate.slice(0, 10) : "",
      price: rule.price != null ? String(rule.price) : "",
      adjustment: rule.adjustment != null ? String(rule.adjustment) : "",
      adjType: rule.adjType || "PERCENT",
      minNights: String(rule.minNights || 1),
      priority: String(rule.priority ?? 0),
      daysOfWeek: rule.daysOfWeek ? (JSON.parse(rule.daysOfWeek) as number[]) : [],
      active: rule.active,
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function saveRule() {
    setSaveError(null);
    const body: Record<string, unknown> = {
      ...form,
      propertyId: selectedProperty,
      price: form.price ? Number(form.price) : undefined,
      adjustment: form.adjustment ? Number(form.adjustment) : undefined,
      minNights: Number(form.minNights),
      priority: Number(form.priority),
      daysOfWeek: form.daysOfWeek.length > 0 ? form.daysOfWeek : undefined,
    };
    if (editingId) body.id = editingId;
    const res = await fetch("/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const saved = await res.json();
      // The update branch of the API doesn't re-include `property` on its
      // response (only create does) - spreading onto the existing row keeps
      // it, the same defensive merge toggleRule already relies on below.
      setRules((prev) =>
        editingId ? prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)) : [...prev, saved]
      );
      setShowForm(false);
      setEditingId(null);
      setForm(blankForm);
      return;
    }
    // A rejected save used to do nothing at all - the form just sat there,
    // indistinguishable from a click that never registered.
    const detail = await res.json().catch(() => null);
    setSaveError(
      typeof detail?.error === "string"
        ? detail.error
        : `Could not save this rule (${res.status}). Check the dates and price and try again.`
    );
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/pricing?id=${id}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function toggleRule(rule: PricingRule) {
    const res = await fetch("/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, active: !rule.active }),
    });
    if (res.ok) {
      const updated = await res.json();
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...updated } : r)));
    }
  }

  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function toggleDay(d: number) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d].sort(),
    }));
  }

  const selectedProp = properties.find((p) => p.id === selectedProperty);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pricing</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage rates and pricing rules</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/pricing/calendar" className="flex items-center gap-2 border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2.5 rounded-xl text-sm font-medium transition">
            <CalendarDays className="w-4 h-4" /> Live prices
          </Link>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>

      {/* Property Selector */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-700">Property:</label>
          <select
            value={selectedProperty}
            onChange={(e) => setSelectedProperty(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selectedProp && (
            <span className="text-sm text-slate-500">
              Base rate: <strong>{selectedProp.currency} {selectedProp.basePrice}/night</strong>
            </span>
          )}
        </div>
      </div>

      {/* Add / Edit Rule Form - same shape either way, just pre-filled and
          POSTed with an id when editing (see openEdit / saveRule).
          Opens as a fixed sheet rather than inline in the page flow: editing
          a rule near the bottom of a long list used to mean scrolling all
          the way back to the top to reach the form. Same sheet chrome as the
          price calendar on the Calendar tab, so it's now the one place in
          the app "click something in a list, edit it here" looks like. */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => { setShowForm(false); setEditingId(null); }}
          />
          <div className="relative w-full max-w-2xl max-h-[88vh] bg-white rounded-t-3xl shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-4 py-3 flex items-center gap-3">
              <span className="w-9 h-1 bg-slate-200 rounded-full absolute left-1/2 -translate-x-1/2 top-1.5" />
              <h3 className="font-semibold text-slate-900 mt-1">{editingId ? "Edit Pricing Rule" : "New Pricing Rule"}</h3>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rule Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Summer 2025"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rule Type</label>
              <select
                value={form.ruleType}
                onChange={(e) => setForm({ ...form, ruleType: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(RULE_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {/* Dates apply to any rule type, not just Seasonal/Last Minute -
                a Weekend rule can span a season just as easily (see the
                seeded "Weekend uplift" rule, which covers the whole
                500-day horizon). Left blank, a rule applies always. */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date <span className="text-slate-400 font-normal">(optional)</span></label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Date <span className="text-slate-400 font-normal">(optional)</span></label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {form.ruleType === "WEEKEND" && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Applies on</label>
                <div className="flex flex-wrap gap-1.5">
                  {DOW_LABELS.map((label, d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                        form.daysOfWeek.includes(d)
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">None selected = every day.</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fixed Price (or leave blank)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="150"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Adjustment</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={form.adjustment}
                  onChange={(e) => setForm({ ...form, adjustment: e.target.value })}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="+20 or -10"
                />
                <select
                  value={form.adjType}
                  onChange={(e) => setForm({ ...form, adjType: e.target.value })}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="PERCENT">%</option>
                  <option value="FIXED">Fixed</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Min. Nights</label>
              <input
                type="number"
                value={form.minNights}
                onChange={(e) => setForm({ ...form, minNights: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="0"
              />
              <p className="text-xs text-slate-500 mt-1">
                Higher wins where rules overlap. Seeded seasons use 10, weekend uplifts 20, and a
                manual calendar override is 50 — so a rule above 50 beats everything.
              </p>
            </div>
          </div>
          {saveError && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{saveError}</div>
          )}
          <div className="flex gap-3 mt-4">
            <button
              onClick={saveRule}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {editingId ? "Save Changes" : "Save Rule"}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
            >
              Cancel
            </button>
          </div>
            </div>
          </div>
        </div>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 text-center py-16">
          <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-400">No pricing rules yet</p>
        </div>
      ) : (
        <>
          {/* Mobile cards — every field on its own line, nothing to scroll or crop */}
          <div className="md:hidden space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="bg-white rounded-2xl border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">{rule.name}</p>
                    <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                      {RULE_TYPE_LABELS[rule.ruleType] || rule.ruleType}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(rule)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <dt className="text-slate-500">Rate</dt>
                  <dd className="text-right">
                    {rule.price && <span className="font-medium text-slate-900">{ruleCurrency(rule)} {rule.price}/night</span>}
                    {rule.adjustment && (
                      <span className={`font-medium ${rule.adjustment > 0 ? "text-green-600" : "text-red-600"}`}>
                        {rule.adjustment > 0 ? "+" : ""}{rule.adjustment}{rule.adjType === "PERCENT" ? "%" : ` ${ruleCurrency(rule)}`}
                      </span>
                    )}
                    {!rule.price && !rule.adjustment && <span className="text-slate-400">—</span>}
                  </dd>
                  <dt className="text-slate-500">Period</dt>
                  <dd className="text-right text-slate-700">
                    {rule.startDate && rule.endDate
                      ? `${new Date(rule.startDate).toLocaleDateString()} — ${new Date(rule.endDate).toLocaleDateString()}`
                      : "Always"}
                  </dd>
                  <dt className="text-slate-500">Min. nights</dt>
                  <dd className="text-right text-slate-700">{rule.minNights || 1} nights</dd>
                </dl>
                <button
                  onClick={() => toggleRule(rule)}
                  className={`mt-3 w-full flex items-center justify-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-medium border transition ${
                    rule.active
                      ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                      : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${rule.active ? "bg-green-600" : "bg-slate-400"}`} />
                  {rule.active ? "Active" : "Inactive"}
                  <span className="text-[10px] opacity-70">— tap to {rule.active ? "deactivate" : "activate"}</span>
                </button>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Rule</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Type</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Rate</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Period</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Min Nights</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-5 py-4">Status</th>
                <th className="px-5 py-4"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-medium text-slate-900 text-sm">{rule.name}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">
                      {RULE_TYPE_LABELS[rule.ruleType] || rule.ruleType}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {rule.price && <span className="text-sm font-medium text-slate-900">{ruleCurrency(rule)} {rule.price}/night</span>}
                    {rule.adjustment && (
                      <span className={`text-sm font-medium ${rule.adjustment > 0 ? "text-green-600" : "text-red-600"}`}>
                        {rule.adjustment > 0 ? "+" : ""}{rule.adjustment}{rule.adjType === "PERCENT" ? "%" : ` ${ruleCurrency(rule)}`}
                      </span>
                    )}
                    {!rule.price && !rule.adjustment && <span className="text-slate-400 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-500">
                    {rule.startDate && rule.endDate
                      ? `${new Date(rule.startDate).toLocaleDateString()} — ${new Date(rule.endDate).toLocaleDateString()}`
                      : "Always"}
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-700">{rule.minNights || 1} nights</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => toggleRule(rule)}
                      title={`Tap to ${rule.active ? "deactivate" : "activate"}`}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border transition ${
                        rule.active
                          ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                          : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${rule.active ? "bg-green-600" : "bg-slate-400"}`} />
                      {rule.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(rule)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
