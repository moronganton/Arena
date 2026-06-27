"use client";
import { useState, useEffect } from "react";
import { Plus, Trash2, Edit, DollarSign } from "lucide-react";

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
  active: boolean;
  property: { id: string; name: string; currency: string };
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
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    ruleType: "SEASONAL",
    startDate: "",
    endDate: "",
    price: "",
    adjustment: "",
    adjType: "PERCENT",
    minNights: "1",
    active: true,
  });

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((data) => {
        setProperties(data);
        if (data.length > 0) setSelectedProperty(data[0].id);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    fetch(`/api/pricing?propertyId=${selectedProperty}`)
      .then((r) => r.json())
      .then(setRules);
  }, [selectedProperty]);

  async function createRule() {
    const res = await fetch("/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        propertyId: selectedProperty,
        price: form.price ? Number(form.price) : undefined,
        adjustment: form.adjustment ? Number(form.adjustment) : undefined,
        minNights: Number(form.minNights),
      }),
    });
    if (res.ok) {
      const rule = await res.json();
      setRules((prev) => [...prev, rule]);
      setShowForm(false);
      setForm({ name: "", ruleType: "SEASONAL", startDate: "", endDate: "", price: "", adjustment: "", adjType: "PERCENT", minNights: "1", active: true });
    }
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

  const selectedProp = properties.find((p) => p.id === selectedProperty);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pricing</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage rates and pricing rules</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
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

      {/* Add Rule Form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">New Pricing Rule</h3>
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
            {(form.ruleType === "SEASONAL" || form.ruleType === "LAST_MINUTE") && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
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
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={createRule}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              Save Rule
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

      {/* Rules List */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {rules.length === 0 ? (
          <div className="text-center py-16">
            <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">No pricing rules yet</p>
          </div>
        ) : (
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
                    {rule.price && <span className="text-sm font-medium text-slate-900">{rule.property.currency} {rule.price}/night</span>}
                    {rule.adjustment && (
                      <span className={`text-sm font-medium ${rule.adjustment > 0 ? "text-green-600" : "text-red-600"}`}>
                        {rule.adjustment > 0 ? "+" : ""}{rule.adjustment}{rule.adjType === "PERCENT" ? "%" : ` ${rule.property.currency}`}
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
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        rule.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {rule.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
