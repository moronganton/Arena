"use client";
import { useState, useEffect, useCallback } from "react";
import { Trash2, Upload, Send, Check } from "lucide-react";

// Every panel here is Channex-only - each one calls a /api/channex/* route
// that talks to Channex's own catalogue APIs, so none of it applies to a
// Smoobu-managed property. Moved out of the old standalone
// /settings/listing-content page so this lives at the property level
// instead, alongside the property it actually configures.

export const inputCls = "w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

// ---------- Hotel Policy ----------

const DEFAULT_POLICY = {
  title: "Hotel Policy",
  currency: "EUR",
  is_adults_only: false,
  max_count_of_guests: 4,
  // Channex's real required fields are an arrival/departure WINDOW, not a
  // single time - confirmed live, the docs' example payload (checkin_time/
  // checkout_time alone) was rejected as missing these.
  checkin_from_time: "15:00",
  checkin_to_time: "22:00",
  checkout_from_time: "08:00",
  checkout_to_time: "11:00",
  self_checkin_checkout: false,
  infant_max_age: null as number | null,
  children_max_age: null as number | null,
  internet_access_type: "wifi" as const,
  internet_access_coverage: "entire_property" as const,
  internet_access_cost: null as number | null,
  parking_type: "none" as const,
  parking_reservation: "not_available" as const,
  parking_is_private: false,
  parking_cost: null as number | null,
  pets_policy: "not_allowed" as const,
  pets_non_refundable_fee: "0.00",
  pets_refundable_deposit: "0.00",
  smoking_policy: "no_smoking" as const,
  enhanced_cleaning_practices: false,
  cleaning_practices_description: "" as string | null,
  partner_hygiene_link: "" as string | null,
};

export function HotelPolicyPanel({ propertyId }: { propertyId: string }) {
  const [form, setForm] = useState(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    fetch(`/api/channex/hotel-policy?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.policy) setForm({ ...DEFAULT_POLICY, ...d.policy });
        else setForm(DEFAULT_POLICY);
      })
      .catch(() => setError("Could not load hotel policy"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/channex/hotel-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading&hellip;</p>;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Title">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Currency">
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })} className={inputCls} />
        </Field>
        <Field label="Check-in from">
          <input type="time" value={form.checkin_from_time} onChange={(e) => setForm({ ...form, checkin_from_time: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Check-in until">
          <input type="time" value={form.checkin_to_time} onChange={(e) => setForm({ ...form, checkin_to_time: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Check-out from">
          <input type="time" value={form.checkout_from_time} onChange={(e) => setForm({ ...form, checkout_from_time: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Check-out until">
          <input type="time" value={form.checkout_to_time} onChange={(e) => setForm({ ...form, checkout_to_time: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Self check-in & checkout">
          <select value={String(form.self_checkin_checkout)} onChange={(e) => setForm({ ...form, self_checkin_checkout: e.target.value === "true" })} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Max guests">
          <input type="number" min={1} value={form.max_count_of_guests} onChange={(e) => setForm({ ...form, max_count_of_guests: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="Adults only">
          <select value={String(form.is_adults_only)} onChange={(e) => setForm({ ...form, is_adults_only: e.target.value === "true" })} className={inputCls}>
            <option value="false">No - children welcome</option>
            <option value="true">Yes - adults only</option>
          </select>
        </Field>
        <Field label="Infant max age">
          <input type="number" min={0} placeholder="Not set" value={form.infant_max_age ?? ""} onChange={(e) => setForm({ ...form, infant_max_age: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="Children max age">
          <input type="number" min={0} placeholder="Not set" value={form.children_max_age ?? ""} onChange={(e) => setForm({ ...form, children_max_age: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls} />
        </Field>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-3">Internet access</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Internet">
          <select value={form.internet_access_type} onChange={(e) => setForm({ ...form, internet_access_type: e.target.value as typeof form.internet_access_type })} className={inputCls}>
            <option value="wifi">WiFi</option>
            <option value="wired">Wired</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field label="Internet coverage">
          <select value={form.internet_access_coverage} onChange={(e) => setForm({ ...form, internet_access_coverage: e.target.value as typeof form.internet_access_coverage })} className={inputCls}>
            <option value="entire_property">Entire property</option>
            <option value="public_areas">Public areas</option>
            <option value="all_rooms">All rooms</option>
            <option value="some_rooms">Some rooms</option>
            <option value="business_centre">Business centre</option>
          </select>
        </Field>
        <Field label="Internet cost">
          <input type="number" min={0} step="0.01" placeholder="Free" value={form.internet_access_cost ?? ""} onChange={(e) => setForm({ ...form, internet_access_cost: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls} />
        </Field>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-3">Parking</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Parking">
          <select value={form.parking_type} onChange={(e) => setForm({ ...form, parking_type: e.target.value as typeof form.parking_type })} className={inputCls}>
            <option value="none">None</option>
            <option value="on_site">On site</option>
            <option value="nearby">Nearby</option>
          </select>
        </Field>
        <Field label="Parking reservation">
          <select value={form.parking_reservation} onChange={(e) => setForm({ ...form, parking_reservation: e.target.value as typeof form.parking_reservation })} className={inputCls}>
            <option value="not_available">Not available</option>
            <option value="not_needed">Not needed</option>
            <option value="needed">Needed</option>
          </select>
        </Field>
        <Field label="Private parking">
          <select value={String(form.parking_is_private)} onChange={(e) => setForm({ ...form, parking_is_private: e.target.value === "true" })} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Parking cost">
          <input type="number" min={0} step="0.01" placeholder="Free" value={form.parking_cost ?? ""} onChange={(e) => setForm({ ...form, parking_cost: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls} />
        </Field>
      </div>

      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-3">Other</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Pets">
          <select value={form.pets_policy} onChange={(e) => setForm({ ...form, pets_policy: e.target.value as typeof form.pets_policy })} className={inputCls}>
            <option value="not_allowed">Not allowed</option>
            <option value="allowed">Allowed</option>
            <option value="by_arrangements">By arrangement</option>
            <option value="assistive_only">Assistive animals only</option>
          </select>
        </Field>
        <Field label="Smoking">
          <select value={form.smoking_policy} onChange={(e) => setForm({ ...form, smoking_policy: e.target.value as typeof form.smoking_policy })} className={inputCls}>
            <option value="no_smoking">No smoking</option>
            <option value="permitted_areas_only">Permitted areas only</option>
            <option value="allowed">Allowed</option>
          </select>
        </Field>
        <Field label="Pet non-refundable fee">
          <input value={form.pets_non_refundable_fee} onChange={(e) => setForm({ ...form, pets_non_refundable_fee: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Pet refundable deposit">
          <input value={form.pets_refundable_deposit} onChange={(e) => setForm({ ...form, pets_refundable_deposit: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Enhanced cleaning practices">
          <select value={String(form.enhanced_cleaning_practices)} onChange={(e) => setForm({ ...form, enhanced_cleaning_practices: e.target.value === "true" })} className={inputCls}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Partner hygiene link">
          <input placeholder="https://…" value={form.partner_hygiene_link ?? ""} onChange={(e) => setForm({ ...form, partner_hygiene_link: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Cleaning practices description" full>
          <textarea rows={3} value={form.cleaning_practices_description ?? ""} onChange={(e) => setForm({ ...form, cleaning_practices_description: e.target.value })} className={inputCls} />
        </Field>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
          {saving ? "Saving…" : "Save policy"}
        </button>
        {saved && <span className="text-emerald-600 text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>
    </div>
  );
}

// ---------- Facilities ----------

interface FacilityOption { id: string; category: string; title: string }

export function FacilitiesPanel({ propertyId }: { propertyId: string }) {
  const [options, setOptions] = useState<FacilityOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    fetch(`/api/channex/facilities?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => {
        setOptions(d.options ?? []);
        setSelected(new Set(d.selectedIds ?? []));
      })
      .finally(() => setLoading(false));
  }, [propertyId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/channex/facilities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, facilityIds: Array.from(selected) }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading&hellip;</p>;

  const byCategory = options.reduce<Record<string, FacilityOption[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <p className="text-xs text-slate-400 mb-3">{selected.size} of {options.length} selected</p>
      <div className="max-h-[28rem] overflow-y-auto space-y-4 pr-1">
        {Object.entries(byCategory).map(([category, items]) => (
          <div key={category}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{category.replace(/_/g, " ")}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {items.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer py-0.5">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} className="accent-indigo-600" />
                  {f.title}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
        <button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
          {saving ? "Saving…" : "Save facilities"}
        </button>
        {saved && <span className="text-emerald-600 text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
      </div>
    </div>
  );
}

// ---------- Photos ----------

interface ChannexPhoto { id: string; url: string; position: number; description: string | null }

export function PhotosPanel({ propertyId }: { propertyId: string }) {
  const [photos, setPhotos] = useState<ChannexPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!propertyId) return;
    setLoading(true);
    fetch(`/api/channex/photos?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => setPhotos(d.photos ?? []))
      .finally(() => setLoading(false));
  }, [propertyId]);

  useEffect(load, [load]);

  function onFile(file: File) {
    setError(null);
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/channex/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyId, dataUrl: reader.result }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Upload failed");
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setError("Couldn't read that file");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function remove(photoId: string) {
    await fetch("/api/channex/photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, photoId }),
    });
    load();
  }

  if (loading) return <p className="text-sm text-slate-400">Loading&hellip;</p>;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <label className="flex items-center gap-2 w-fit text-sm font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-3 py-2 rounded-xl cursor-pointer transition mb-4">
        <Upload className={`w-4 h-4 ${uploading ? "animate-bounce" : ""}`} />
        {uploading ? "Uploading…" : "Upload photo"}
        <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </label>
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {photos.length === 0 ? (
        <p className="text-sm text-slate-400">No photos yet. The first one uploaded becomes the cover photo.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((p, i) => (
            <div key={p.id} className="relative group rounded-xl overflow-hidden border border-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote Channex-hosted photo */}
              <img src={p.url} alt={p.description || "Property photo"} className="w-full aspect-square object-cover" />
              {i === 0 && <span className="absolute top-1.5 left-1.5 text-[10px] font-medium bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">Cover</span>}
              <button
                onClick={() => remove(p.id)}
                className="absolute top-1.5 right-1.5 p-1.5 bg-white/90 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-lg opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Reviews ----------

interface Review {
  id: string;
  content: string;
  guest_name: string;
  ota: string;
  overall_score: number;
  received_at: string;
  is_replied: boolean;
  reply: string | null;
}

export function ReviewsPanel({ propertyId }: { propertyId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/channex/reviews?propertyId=${propertyId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || "Failed to load reviews");
        setReviews(d.reviews ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reviews"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  useEffect(load, [load]);

  async function sendReply(reviewId: string) {
    const reply = replyDrafts[reviewId]?.trim();
    if (!reply) return;
    setReplying(reviewId);
    try {
      const res = await fetch("/api/channex/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, reviewId, reply }),
      });
      if (res.ok) load();
    } finally {
      setReplying(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading&hellip;</p>;
  if (error) return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">{error}</p>;
  if (reviews.length === 0) return <p className="text-sm text-slate-400">No reviews yet.</p>;

  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <div key={r.id} className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-900">{r.guest_name || "Guest"}</span>
              <span className="text-xs text-slate-400">via {r.ota}</span>
            </div>
            <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{r.overall_score.toFixed(1)}/10</span>
          </div>
          <p className="text-sm text-slate-700 mb-2">{r.content}</p>
          <p className="text-xs text-slate-400 mb-2">{new Date(r.received_at).toLocaleDateString()}</p>

          {r.is_replied ? (
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-600">
              <span className="text-xs font-medium text-slate-400 block mb-0.5">Your reply</span>
              {r.reply}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={replyDrafts[r.id] || ""}
                onChange={(e) => setReplyDrafts({ ...replyDrafts, [r.id]: e.target.value })}
                placeholder="Write a reply…"
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => sendReply(r.id)}
                disabled={replying === r.id || !replyDrafts[r.id]?.trim()}
                className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg transition"
              >
                <Send className="w-3.5 h-3.5" />
                {replying === r.id ? "Sending…" : "Reply"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Payments setup (Channex's own Stripe Connect) ----------

export function PaymentsSetupPanel({ propertyId }: { propertyId: string }) {
  const [status, setStatus] = useState<{ installed: boolean; connected: boolean; providers: Array<{ id: string; title: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    fetch(`/api/channex/payments/setup?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then(setStatus)
      .finally(() => setLoading(false));
  }, [propertyId]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/channex/payments/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not start Stripe connection");
      window.location.href = data.connectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Stripe connection");
      setConnecting(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading&hellip;</p>;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <p className="text-sm text-slate-600 mb-4">
        Charge guest cards directly through Channex&apos;s Stripe integration - only works for reservations that came
        through Channex, since the charge is tied to the Channex booking.
      </p>
      {status?.connected ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <Check className="w-4 h-4" />
          Stripe connected{status.providers[0] ? ` (${status.providers[0].title})` : ""}
        </div>
      ) : (
        <button onClick={connect} disabled={connecting} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition">
          {connecting ? "Redirecting…" : "Connect Stripe"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
