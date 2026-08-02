"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquarePlus, Save, Trash2, RefreshCw, ChevronLeft, Plus, Clock, Building2, Smile, Braces, Info, Send } from "lucide-react";
import { ImageGallery } from "@/components/templates/ImageGallery";

interface Field { token: string; key: string; label: string; description: string; example: string; }
interface Trigger { value: string; label: string; description: string; usesOffset: boolean; offsetDir: "before" | "after" | null; anchor: string | null; }
interface PropertyLite { id: string; name: string; }
interface Template {
  id: string; name: string; trigger: string; offsetDays: number; sendHour: number;
  subject: string; body: string; active: boolean; propertyId: string | null;
  property?: { id: string; name: string } | null; _count?: { sends: number };
}

const EMOJIS = ["👋","🏠","🔑","📶","🚗","🅿️","🛎️","✅","😊","🙏","🌟","⭐","📍","🕐","☀️","🧳","🛏️","🚿","☕","🍽️","📞","💬","❤️","🎉"];

const BLANK: Omit<Template, "id"> = {
  name: "", trigger: "BEFORE_CHECKIN", offsetDays: 2, sendHour: 10,
  subject: "Message from your host", body: "", active: true, propertyId: null,
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [view, setView] = useState<"list" | "edit">("list");
  const [form, setForm] = useState<Template | Omit<Template, "id">>(BLANK);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterProp, setFilterProp] = useState(""); // "" = all, "GLOBAL" = all-properties, or a propertyId
  const [showFields, setShowFields] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Real-data preview + test send
  const [reservations, setReservations] = useState<{ id: string; label: string }[]>([]);
  const [previewResId, setPreviewResId] = useState("");
  const [realPreview, setRealPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [copyEmail, setCopyEmail] = useState("");
  const [sendingCopy, setSendingCopy] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [sendingGuest, setSendingGuest] = useState(false);
  const [guestMsg, setGuestMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [t, s, r] = await Promise.all([
      fetch("/api/templates").then((r) => r.json()),
      fetch("/api/templates/schema").then((r) => r.json()),
      fetch("/api/templates/reservations").then((r) => r.json()),
    ]);
    setTemplates(t.templates || []);
    setProperties(t.properties || []);
    setFields(s.fields || []);
    setTriggers(s.triggers || []);
    setReservations(r.reservations || []);
    setCopyEmail((prev) => prev || t.userEmail || "");
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // When a real reservation is chosen, render the template with its real data
  // (debounced so it keeps up as you type).
  useEffect(() => {
    if (!previewResId) { setRealPreview(null); return; }
    setPreviewing(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch("/api/templates/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: form.body, reservationId: previewResId }),
        });
        const data = await res.json();
        setRealPreview(res.ok ? data.rendered : null);
      } finally { setPreviewing(false); }
    }, 400);
    return () => clearTimeout(h);
  }, [previewResId, form.body]);

  async function sendCopy() {
    setSendingCopy(true);
    setCopyMsg("");
    const res = await fetch("/api/templates/send-copy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: form.subject, body: form.body, reservationId: previewResId || undefined, to: copyEmail }),
    });
    const data = await res.json();
    setSendingCopy(false);
    setCopyMsg(res.ok ? `Sent to ${data.to} ✓` : (data.error || "Failed to send"));
    setTimeout(() => setCopyMsg(""), 7000);
  }

  async function sendGuest() {
    if (!previewResId) return;
    const resv = reservations.find((r) => r.id === previewResId);
    if (!confirm(`Send this message to the GUEST on:\n\n${resv?.label}\n\nThis reaches the real guest via their booking channel and email.`)) return;
    setSendingGuest(true);
    setGuestMsg("");
    const res = await fetch("/api/templates/send-now", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "id" in form ? form.id : undefined, body: form.body, reservationId: previewResId }),
    });
    const data = await res.json();
    setSendingGuest(false);
    setGuestMsg(res.ok ? `Sent to ${data.guest} ✓` : (data.error || "Failed to send"));
    setTimeout(() => setGuestMsg(""), 7000);
  }

  const selectedTrigger = triggers.find((t) => t.value === form.trigger);
  const showOffset = selectedTrigger?.usesOffset;
  const showHour = form.trigger !== "MANUAL" && form.trigger !== "NEW_RESERVATION";

  function newTemplate() { setForm(BLANK); setView("edit"); }
  function editTemplate(t: Template) { setForm(t); setView("edit"); }

  function insertAtCursor(text: string) {
    const el = bodyRef.current;
    const cur = form.body || "";
    if (!el) { setForm({ ...form, body: cur + text }); return; }
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + text + cur.slice(end);
    setForm({ ...form, body: next });
    requestAnimationFrame(() => { el.focus(); const p = start + text.length; el.setSelectionRange(p, p); });
  }

  async function save() {
    if (!form.name.trim() || !form.body.trim()) return;
    setSaving(true);
    const isEdit = "id" in form && form.id;
    const res = await fetch("/api/templates", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { await load(); setView("list"); }
  }

  async function remove() {
    if (!("id" in form) || !form.id) return;
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates?id=${form.id}`, { method: "DELETE" });
    await load();
    setView("list");
  }

  async function toggleActive(t: Template) {
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)));
    await fetch("/api/templates", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, active: !t.active }),
    });
  }

  // Live preview: replace every token with its example value
  const preview = (() => {
    let out = form.body || "";
    for (const f of fields) out = out.split(f.token).join(f.example);
    return out;
  })();

  function timingText(t: Template): string {
    const tr = triggers.find((x) => x.value === t.trigger);
    if (!tr) return t.trigger;
    if (t.trigger === "MANUAL") return "Manual only";
    if (tr.usesOffset) return `${t.offsetDays} day${t.offsetDays === 1 ? "" : "s"} ${tr.offsetDir} ${tr.anchor === "checkIn" ? "check-in" : "check-out"} · ${String(t.sendHour).padStart(2, "0")}:00`;
    if (t.trigger === "NEW_RESERVATION") return "When booked";
    return `${tr.label} · ${String(t.sendHour).padStart(2, "0")}:00`;
  }

  const visibleTemplates = templates.filter((t) =>
    filterProp === "" ? true : filterProp === "GLOBAL" ? t.propertyId === null : t.propertyId === filterProp
  );
  const countFor = (val: string) =>
    templates.filter((t) => (val === "GLOBAL" ? t.propertyId === null : t.propertyId === val)).length;

  // ---------- LIST VIEW ----------
  if (view === "list") {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Message Templates</h1>
            <p className="text-slate-500 text-sm mt-0.5">Design guest messages once — StayHQ personalizes and sends them automatically.</p>
          </div>
          <button onClick={newTemplate} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" /> New Template
          </button>
        </div>

        {/* Filter by property */}
        {!loading && templates.length > 0 && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="text-xs font-medium text-slate-500 inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> View</span>
            <button
              onClick={() => setFilterProp("")}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${filterProp === "" ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`}
            >
              All ({templates.length})
            </button>
            <button
              onClick={() => setFilterProp("GLOBAL")}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${filterProp === "GLOBAL" ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`}
            >
              All properties ({countFor("GLOBAL")})
            </button>
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => setFilterProp(p.id)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${filterProp === p.id ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`}
              >
                {p.name} ({countFor(p.id)})
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
            <MessageSquarePlus className="w-10 h-10 text-indigo-300 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-900">No templates yet</h3>
            <p className="text-sm text-slate-500 mt-1 mb-4">Create your first automated message — a pre-arrival note, check-in code, or review request.</p>
            <button onClick={newTemplate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium">
              <Plus className="w-4 h-4" /> New Template
            </button>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-500">
            No templates for this property yet.
            <button onClick={newTemplate} className="ml-1 text-indigo-600 font-medium hover:underline">Create one</button>.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleTemplates.map((t) => (
              <div key={t.id} className="bg-white rounded-2xl border border-slate-100 p-4 flex items-start gap-4">
                <button onClick={() => editTemplate(t)} className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{t.name}</span>
                    {!t.active && <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Paused</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{timingText(t)}</span>
                    <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{t.property?.name || "All properties"}</span>
                    {t._count && <span>{t._count.sends} sent</span>}
                  </div>
                  <p className="text-sm text-slate-600 mt-2 line-clamp-2">{t.body}</p>
                </button>
                <button
                  onClick={() => toggleActive(t)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${t.active ? "bg-indigo-600" : "bg-slate-300"}`}
                  title={t.active ? "Active" : "Paused"}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${t.active ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Scheduler setup note */}
        <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-indigo-900">
            <p className="font-medium">How sending works</p>
            <p className="text-indigo-800/80 mt-1">
              Scheduled templates fire automatically once the scheduler runs (hourly). Messages go to guests by email, and — when the booking came through Smoobu — into the Booking.com/Airbnb chat too. Turn a template off with its toggle to pause it without deleting.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- EDIT VIEW ----------
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <button onClick={() => setView("list")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ChevronLeft className="w-4 h-4" /> Back to templates
      </button>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        {/* Builder */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Template name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Pre-arrival welcome"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Trigger */}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">When should it send?</label>
              <select
                value={form.trigger}
                onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {selectedTrigger && <p className="text-xs text-slate-500 mt-1.5">{selectedTrigger.description}</p>}
            </div>

            {/* Timing */}
            {(showOffset || showHour) && (
              <div className="flex flex-wrap gap-4">
                {showOffset && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Days {selectedTrigger?.offsetDir} {selectedTrigger?.anchor === "checkIn" ? "check-in" : "check-out"}</label>
                    <input
                      type="number" min={0} max={60}
                      value={form.offsetDays}
                      onChange={(e) => setForm({ ...form, offsetDays: parseInt(e.target.value || "0") })}
                      className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {showHour && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Send at (hour, UTC)</label>
                    <select
                      value={form.sendHour}
                      onChange={(e) => setForm({ ...form, sendHour: parseInt(e.target.value) })}
                      className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Property scope */}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Applies to</label>
              <select
                value={form.propertyId || ""}
                onChange={(e) => setForm({ ...form, propertyId: e.target.value || null })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Email subject */}
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">Email subject <span className="text-slate-400 font-normal">(used when sent by email)</span></label>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Message body */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-800">Message</label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button onClick={() => { setShowFields((v) => !v); setShowEmojis(false); }} className="flex items-center gap-1.5 text-xs border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition">
                    <Braces className="w-3.5 h-3.5" /> Insert field
                  </button>
                  {showFields && (
                    <div className="absolute right-0 mt-1 w-72 max-h-80 overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 z-20 p-1">
                      {fields.map((f) => (
                        <button key={f.key} onClick={() => { insertAtCursor(f.token); setShowFields(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50 transition">
                          <span className="font-mono text-xs text-indigo-600">{f.token}</span>
                          <span className="block text-[11px] text-slate-500">{f.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button onClick={() => { setShowEmojis((v) => !v); setShowFields(false); }} className="flex items-center gap-1.5 text-xs border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition">
                    <Smile className="w-3.5 h-3.5" /> Emoji
                  </button>
                  {showEmojis && (
                    <div className="absolute right-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-20 p-2 grid grid-cols-8 gap-1">
                      {EMOJIS.map((e) => (
                        <button key={e} onClick={() => { insertAtCursor(e); setShowEmojis(false); }} className="text-lg hover:bg-slate-100 rounded-md p-1">{e}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <textarea
              ref={bodyRef}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={8}
              placeholder={"Dear [First Name] 👋\n\nWe're looking forward to welcoming you to [Property Name] on [Check-in Date]. Your door code is [Access Code].\n\nAny questions, just reply here!\n[Host Name]"}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono leading-relaxed"
            />
            <p className=”text-xs text-slate-400 mt-2”>Type <span className=”font-mono text-slate-500”>[Field]</span> tags or use “Insert field”. They&apos;re replaced with each guest&apos;s real details when sent.</p>
          </div>

          {/* Images */}
          {“id” in form ? (
            <div className=”bg-white rounded-2xl border border-slate-100 p-5”>
              <ImageGallery templateId={(form as any).id} />
            </div>
          ) : null}

          {/* Live preview + test */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-medium text-slate-800">Preview</h3>
              </div>
              <select
                value={previewResId}
                onChange={(e) => setPreviewResId(e.target.value)}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs max-w-[240px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                title="Preview with a real reservation's data"
              >
                <option value="">Sample data</option>
                {reservations.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm text-slate-800 whitespace-pre-wrap min-h-[80px]">
              {previewResId
                ? (previewing ? <span className="text-slate-400">Rendering with real data…</span> : (realPreview || <span className="text-slate-400">No preview.</span>))
                : (preview || <span className="text-slate-400">Your message preview will appear here…</span>)}
            </div>

            <p className="text-[11px] text-slate-400 mt-2">
              {previewResId ? "Showing this template filled with the selected reservation's real details." : "Showing sample values. Pick a reservation above to preview real guest data."}
            </p>

            <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
              {/* Send a copy to any email address */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Send a copy to</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="email"
                    value={copyEmail}
                    onChange={(e) => setCopyEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={sendCopy}
                    disabled={sendingCopy || !form.body.trim() || !copyEmail.trim()}
                    className="flex items-center gap-2 border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3.5 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap"
                  >
                    {sendingCopy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send copy
                  </button>
                  {copyMsg && <span className="text-xs font-medium text-emerald-600">{copyMsg}</span>}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">A clean copy to this address{previewResId ? " with the selected reservation's data" : " with sample data"}. The guest is never messaged.</p>
              </div>

              {/* Send for real to the guest */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={sendGuest}
                  disabled={sendingGuest || !form.body.trim() || !previewResId}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-sm font-medium transition"
                >
                  {sendingGuest ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send to guest now
                </button>
                <span className="text-xs text-slate-500">
                  {previewResId ? "Delivers to the real guest (booking channel + email)." : "Pick a reservation above to enable."}
                </span>
                {guestMsg && <span className="text-xs font-medium text-emerald-600">{guestMsg}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving || !form.name.trim() || !form.body.trim()} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save template
            </button>
            {"id" in form && form.id && (
              <button onClick={remove} className="flex items-center gap-2 text-rose-600 hover:bg-rose-50 px-4 py-2.5 rounded-xl text-sm font-medium transition">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
          </div>
        </div>

        {/* Field reference */}
        <aside className="lg:sticky lg:top-6 h-fit">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Dynamic fields</h3>
            <p className="text-xs text-slate-500 mb-4">Each tag is replaced with the guest's real details. Click to insert.</p>
            <div className="space-y-1.5">
              {fields.map((f) => (
                <button key={f.key} onClick={() => insertAtCursor(f.token)} className="w-full text-left p-2.5 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-indigo-600">{f.token}</span>
                    <span className="text-[11px] text-slate-400">{f.example}</span>
                  </div>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{f.description}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
