"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Pencil, Check, RotateCcw, ListChecks } from "lucide-react";

interface Property {
  id: string;
  name: string;
  city?: string;
}

interface Item {
  id: string;
  category: string;
  label: string;
}

export default function ChecklistEditorPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [newItem, setNewItem] = useState({ category: "", label: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((props) => {
        setProperties(Array.isArray(props) ? props : []);
        if (props.length > 0) setPropertyId(props[0].id);
      });
  }, []);

  const loadChecklist = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    const res = await fetch(`/api/cleaning/checklist?propertyId=${propertyId}`);
    const data = await res.json();
    setItems(data.items || []);
    setIsCustom(!!data.custom);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    loadChecklist();
  }, [loadChecklist]);

  async function customize() {
    setBusy(true);
    await fetch("/api/cleaning/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, action: "customize" }),
    });
    await loadChecklist();
    setBusy(false);
  }

  async function resetToDefault() {
    if (!confirm("Remove all custom items and revert to the default checklist?")) return;
    setBusy(true);
    await fetch(`/api/cleaning/checklist?propertyId=${propertyId}&action=reset`, { method: "DELETE" });
    await loadChecklist();
    setBusy(false);
  }

  async function saveEdit(id: string) {
    await fetch("/api/cleaning/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label: editLabel }),
    });
    setEditingId(null);
    await loadChecklist();
  }

  async function deleteItem(id: string) {
    await fetch(`/api/cleaning/checklist?id=${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function addItem() {
    if (!newItem.label.trim() || !newItem.category.trim()) return;
    setBusy(true);
    await fetch("/api/cleaning/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, ...newItem }),
    });
    setNewItem((n) => ({ ...n, label: "" }));
    await loadChecklist();
    setBusy(false);
  }

  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <Link href="/cleaning" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Cleaning
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Cleaning Checklists</h1>
          <p className="text-slate-500 text-sm mt-0.5">Customize the checklist for each property</p>
        </div>
      </div>

      {/* Property selector */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Property</label>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="mt-3 flex items-center justify-between">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isCustom ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
            {isCustom ? "Custom checklist" : "Using default template"}
          </span>
          {isCustom ? (
            <button
              onClick={resetToDefault}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to default
            </button>
          ) : (
            <button
              onClick={customize}
              disabled={busy}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
            >
              <Pencil className="w-3.5 h-3.5" />
              {busy ? "Preparing..." : "Customize this checklist"}
            </button>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-4">Loading...</p>
        ) : (
          <>
            {!isCustom && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
                This is the shared default template. Click <strong>Customize this checklist</strong> above
                to make it editable for this property — e.g. &quot;Add 4 coffee pods per stay&quot;.
              </p>
            )}
            {categories.map((cat) => (
              <div key={cat} className="mb-5 last:mb-0">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{cat}</p>
                <div className="space-y-1.5">
                  {items.filter((i) => i.category === cat).map((item) => (
                    <div key={item.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                      <ListChecks className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      {editingId === item.id ? (
                        <>
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            className="flex-1 border border-indigo-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            autoFocus
                          />
                          <button onClick={() => saveEdit(item.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition">
                            <Check className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-slate-800">{item.label}</span>
                          {isCustom && (
                            <>
                              <button
                                onClick={() => { setEditingId(item.id); setEditLabel(item.label); }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteItem(item.id)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Add item */}
      {isCustom && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
          <h3 className="font-semibold text-slate-900 text-sm mb-3">Add Item</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={newItem.category}
              onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
              placeholder="Category (e.g. Kitchen)"
              list="categories"
              className="sm:w-44 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <input
              value={newItem.label}
              onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
              placeholder='e.g. "Add 4 coffee pods per stay"'
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
            <button
              onClick={addItem}
              disabled={busy || !newItem.label.trim() || !newItem.category.trim()}
              className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
