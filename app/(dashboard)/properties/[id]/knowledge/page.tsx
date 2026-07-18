"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, Check, BookOpen, Sparkles } from "lucide-react";

interface Entry {
  id: string;
  category: string;
  title: string;
  content: string;
}

const SUGGESTED_CATEGORIES = [
  "WiFi", "Check-in & Check-out", "Parking", "House Rules",
  "Appliances", "Trash & Recycling", "Local Tips", "Emergency", "Other",
];

export default function PropertyKnowledgePage() {
  const params = useParams();
  const propertyId = params.id as string;

  const [propertyName, setPropertyName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "WiFi", title: "", content: "" });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "" });

  const load = useCallback(async () => {
    const [prop, data] = await Promise.all([
      fetch(`/api/properties/${propertyId}`).then((r) => r.json()),
      fetch(`/api/knowledge?propertyId=${propertyId}`).then((r) => r.json()),
    ]);
    setPropertyName(prop.name || "");
    setEntries(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addStarter() {
    setBusy(true);
    await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, action: "starter" }),
    });
    await load();
    setBusy(false);
  }

  async function addEntry() {
    if (!form.title.trim() || !form.content.trim()) return;
    setBusy(true);
    await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, ...form }),
    });
    setForm((f) => ({ ...f, title: "", content: "" }));
    setShowAdd(false);
    await load();
    setBusy(false);
  }

  async function saveEdit(id: string) {
    await fetch("/api/knowledge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editForm }),
    });
    setEditingId(null);
    await load();
  }

  async function deleteEntry(id: string) {
    await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const categories = Array.from(new Set(entries.map((e) => e.category)));

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <Link href={`/properties/${propertyId}`} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Property
      </Link>

      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Knowledge Base</h1>
          <p className="text-slate-500 text-sm mt-0.5">{propertyName}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 md:px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Entry</span>
        </button>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-6 text-sm text-indigo-800 flex items-start gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          The AI assistant answers guest questions using these facts. The more complete this is,
          the more messages can be answered automatically — WiFi, parking, appliances, local tips…
        </span>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 text-sm mb-3">New Entry</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="kb-categories"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <datalist id="kb-categories">
                  {SUGGESTED_CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. WiFi password"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Content</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={3}
                placeholder='e.g. "Network: SinteuGuest — Password: Welcome2026"'
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addEntry}
                disabled={busy || !form.title.trim() || !form.content.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                {busy ? "Saving..." : "Add"}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl text-sm font-medium transition bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <p className="text-center text-slate-400 text-sm py-10">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 text-center py-14">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm mb-1">No knowledge yet for this property</p>
          <p className="text-slate-400 text-xs mb-5">Start from a template covering the most common guest questions</p>
          <button
            onClick={addStarter}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition"
          >
            {busy ? "Creating..." : "Add starter template"}
          </button>
        </div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{cat}</p>
            <div className="space-y-2">
              {entries.filter((e) => e.category === cat).map((entry) => (
                <div key={entry.id} className="bg-white rounded-xl border border-slate-100 p-4">
                  {editingId === entry.id ? (
                    <div className="space-y-2">
                      <input
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        className="w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <textarea
                        value={editForm.content}
                        onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                        rows={3}
                        className="w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(entry.id)}
                          className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                        >
                          <Check className="w-3.5 h-3.5" /> Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 text-sm">{entry.title}</p>
                        <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{entry.content}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditForm({ title: entry.title, content: entry.content });
                          }}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
