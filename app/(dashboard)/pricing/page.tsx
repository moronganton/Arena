"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil, CalendarDays, X, ChevronDown, AlertTriangle } from "lucide-react";
import {
  classifyRule,
  describeRule,
  parseDays,
  toDateInput,
  CONCEPT_LABEL,
  MANUAL_PREFIX,
  PRIORITY,
  WEEKEND_DAYS,
  type Concept,
} from "@/lib/pricing-concepts";

// Pricing as four decisions, not a generic rule builder.
//
// The engine underneath is unchanged - every card here still writes a
// PricingRule row. What changed is that the operator no longer meets the row:
// no Rule Type dropdown (the materializer never read it), no Priority integer
// (each concept owns a fixed tier, so a weekend always beats a season and a
// clicked date always beats both), no choosing between price and adjustment on
// the same form. See lib/pricing-concepts.ts for why this vocabulary and not
// the generic one.
//
// Anything that predates this - or that a determined operator builds in the
// advanced drawer - still works and still shows up; it is classified by shape
// rather than hidden.

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
  price?: number | null;
  adjustment?: number | null;
  adjType?: string;
  startDate?: string | null;
  endDate?: string | null;
  daysOfWeek?: string | null;
  minNights?: number | null;
  priority: number;
  active: boolean;
  property?: { id: string; name: string; currency: string };
}

export default function PricingPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [propId, setPropId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((d) => {
        const list: Property[] = Array.isArray(d) ? d : [];
        setProperties(list);
        if (list.length) setPropId((cur) => cur || list[0].id);
      })
      .catch(() => setError("Couldn't load your properties"));
  }, []);

  const loadRules = useCallback(() => {
    if (!propId) return;
    fetch(`/api/pricing?propertyId=${propId}`)
      .then((r) => r.json())
      .then((d) => setRules(Array.isArray(d) ? d : []))
      .catch(() => setError("Couldn't load pricing"));
  }, [propId]);
  useEffect(() => loadRules(), [loadRules]);

  const property = properties.find((p) => p.id === propId);
  const currency = property?.currency ?? "EUR";

  const mine = rules.filter((r) => (r.property?.id ?? propId) === propId);
  const seasons = mine.filter((r) => classifyRule(r as never) === "SEASON");
  const weekend = mine.find((r) => classifyRule(r as never) === "WEEKEND") ?? null;
  const overrides = mine.filter((r) => classifyRule(r as never) === "OVERRIDE");
  const custom = mine.filter((r) => classifyRule(r as never) === "CUSTOM");
  const baseRules = mine.filter((r) => classifyRule(r as never) === "BASE");

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propId, ...body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(typeof d?.error === "string" ? d.error : "Couldn't save that");
        return false;
      }
      loadRules();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/pricing?id=${id}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pricing</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Four settings decide every night&apos;s price. They stack in the order shown.
          </p>
        </div>
        <Link
          href="/pricing/calendar"
          className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
        >
          <CalendarDays className="w-4 h-4" />
          Open calendar
        </Link>
      </div>

      {properties.length > 1 && (
        <select
          value={propId}
          onChange={(e) => setPropId(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm mt-4 max-w-xs w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700 mt-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-4 mt-5">
        <BaseCard
          property={property}
          baseRules={baseRules}
          currency={currency}
          onSaved={() => {
            loadRules();
            // The base price lives on the property, so the selector's copy is
            // stale after an edit until it is re-read.
            fetch("/api/properties")
              .then((r) => r.json())
              .then((d) => Array.isArray(d) && setProperties(d))
              .catch(() => {});
          }}
        />

        <SeasonsCard
          seasons={seasons}
          currency={currency}
          saving={saving}
          onSave={save}
          onRemove={remove}
        />

        <WeekendCard rule={weekend} saving={saving} onSave={save} onRemove={remove} />

        <OverridesCard overrides={overrides} currency={currency} onRemove={remove} />

        {custom.length > 0 && (
          <AdvancedCard rules={custom} currency={currency} onRemove={remove} />
        )}
      </div>
    </div>
  );
}

function Card({
  step,
  title,
  hint,
  children,
}: {
  step: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
          {step}
        </span>
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function BaseCard({
  property,
  baseRules,
  currency,
  onSaved,
}: {
  property?: Property;
  baseRules: PricingRule[];
  currency: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(property ? String(property.basePrice) : ""), [property]);

  async function commit() {
    if (!property) return;
    setBusy(true);
    await fetch(`/api/properties/${property.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePrice: Number(value) }),
    });
    setBusy(false);
    setEditing(false);
    onSaved();
  }

  return (
    <Card step="1" title="Base price" hint="What a night costs when nothing else applies.">
      {editing ? (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Per night ({currency})</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={commit}
            disabled={busy || !value}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium text-slate-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-slate-900 tabular-nums">
            {currency} {property?.basePrice ?? "—"}
          </span>
          <span className="text-sm text-slate-400">/ night</span>
          <button
            onClick={() => setEditing(true)}
            className="ml-auto flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-3 py-1.5 rounded-lg"
          >
            <Pencil className="w-3.5 h-3.5" />
            Change
          </button>
        </div>
      )}

      {/* A base-shaped rule is legacy: the property's own basePrice is the
          floor now, and a full-year rule sitting on top of it is a second
          answer to the same question. Surfaced rather than silently ignored. */}
      {baseRules.length > 0 && (
        <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {baseRules.length === 1 ? "A rule also sets" : `${baseRules.length} rules also set`} a flat price for
          every night ({baseRules.map((r) => r.name).join(", ")}). It overrides the base price above. You can
          remove it in Advanced below if you would rather the base price alone decided.
        </div>
      )}
    </Card>
  );
}

function SeasonsCard({
  seasons,
  currency,
  saving,
  onSave,
  onRemove,
}: {
  seasons: PricingRule[];
  currency: string;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const blank = { name: "", startDate: "", endDate: "", price: "", minNights: "" };
  const [form, setForm] = useState(blank);

  function open(rule?: PricingRule) {
    if (rule) {
      setForm({
        name: rule.name,
        startDate: toDateInput(rule.startDate ?? null),
        endDate: toDateInput(rule.endDate ?? null),
        price: rule.price != null ? String(rule.price) : "",
        minNights: rule.minNights && rule.minNights > 1 ? String(rule.minNights) : "",
      });
      setEditing(rule.id);
    } else {
      setForm(blank);
      setEditing("new");
    }
  }

  async function commit() {
    const ok = await onSave({
      ...(editing !== "new" ? { id: editing } : {}),
      name: form.name || "Season",
      ruleType: "SEASONAL",
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      price: Number(form.price),
      minNights: form.minNights ? Number(form.minNights) : 1,
      priority: PRIORITY.SEASON,
      active: true,
    });
    if (ok) setEditing(null);
  }

  return (
    <Card step="2" title="Seasons" hint="A different price for a stretch of dates. Beats the base price.">
      <div className="space-y-2">
        {seasons.map((s) =>
          editing === s.id ? (
            <SeasonForm
              key={s.id}
              form={form}
              setForm={setForm}
              currency={currency}
              saving={saving}
              onCancel={() => setEditing(null)}
              onSave={commit}
            />
          ) : (
            <div key={s.id} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                <div className="text-xs text-slate-500 tabular-nums">
                  {toDateInput(s.startDate ?? null) || "any"} → {toDateInput(s.endDate ?? null) || "any"}
                  {s.minNights && s.minNights > 1 ? ` · min ${s.minNights} nights` : ""}
                </div>
              </div>
              <span className="text-sm font-bold text-indigo-600 tabular-nums shrink-0">
                {currency} {s.price}
              </span>
              <button onClick={() => open(s)} aria-label={`Edit ${s.name}`} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => onRemove(s.id)} aria-label={`Delete ${s.name}`} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        )}

        {editing === "new" ? (
          <SeasonForm
            form={form}
            setForm={setForm}
            currency={currency}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={commit}
          />
        ) : (
          <button
            onClick={() => open()}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Add a season
          </button>
        )}

        {seasons.length === 0 && editing !== "new" && (
          <p className="text-sm text-slate-400">No seasons yet — every night uses the base price.</p>
        )}
      </div>
    </Card>
  );
}

function SeasonForm({
  form,
  setForm,
  currency,
  saving,
  onCancel,
  onSave,
}: {
  form: { name: string; startDate: string; endDate: string; price: string; minNights: string };
  setForm: (f: { name: string; startDate: string; endDate: string; price: string; minNights: string }) => void;
  currency: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const valid = !!(form.startDate && form.endDate && form.price && form.startDate <= form.endDate);
  return (
    <div className="border border-indigo-200 rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Summer"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Price / night ({currency})</label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="150"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Minimum nights <span className="font-normal text-slate-400">— optional</span>
        </label>
        <input
          type="number"
          min="1"
          value={form.minNights}
          onChange={(e) => setForm({ ...form, minNights: e.target.value })}
          placeholder="Leave blank for no seasonal minimum"
          className="w-full sm:w-64 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {/* The honest caveat, stated where the field is rather than found out
            from a guest booking one night at Christmas. */}
        <p className="text-[11px] text-slate-500 mt-1 max-w-lg">
          This reaches your <strong>Standard Rate</strong> only. Your other rate plans keep their own minimum
          (Weekly 7, Monthly 28, and so on), so a short-stay plan can still sell inside this season.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving || !valid}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium"
        >
          {saving ? "Saving…" : "Save season"}
        </button>
        <button onClick={onCancel} className="border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function WeekendCard({
  rule,
  saving,
  onSave,
  onRemove,
}: {
  rule: PricingRule | null;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState("18");
  const [days, setDays] = useState<number[]>(WEEKEND_DAYS);

  useEffect(() => {
    if (rule) {
      setPct(rule.adjustment != null ? String(rule.adjustment) : "18");
      setDays(parseDays(rule.daysOfWeek ?? null) ?? WEEKEND_DAYS);
    }
  }, [rule]);

  async function commit() {
    const ok = await onSave({
      ...(rule ? { id: rule.id } : {}),
      name: rule?.name || "Weekend",
      ruleType: "WEEKEND",
      daysOfWeek: days,
      adjustment: Number(pct),
      adjType: "PERCENT",
      // Only set on creation. On an edit this stays undefined so the API's
      // update branch leaves the stored value alone - hardcoding 1 here would
      // silently rewrite a minimum the operator set deliberately.
      ...(rule ? {} : { minNights: 1 }),
      priority: PRIORITY.WEEKEND,
      active: true,
    });
    if (ok) setEditing(false);
  }

  return (
    <Card step="3" title="Weekend pricing" hint="A percentage on top, on the days you choose. Beats a season.">
      {!rule && !editing ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-400">Weekends cost the same as any other night.</p>
          <button
            onClick={() => setEditing(true)}
            className="ml-auto flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Add weekend pricing
          </button>
        </div>
      ) : editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Which days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_NAMES.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    days.includes(i)
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Price change</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-500">% &mdash; use a minus for a discount</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={saving || !pct || days.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        rule && (
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800">
                {(parseDays(rule.daysOfWeek ?? null) ?? []).map((d) => DAY_NAMES[d]).join(", ") || "No days"}
              </div>
              <div className="text-xs text-slate-500">
                {toDateInput(rule.startDate ?? null) || toDateInput(rule.endDate ?? null)
                  ? `Only between ${toDateInput(rule.startDate ?? null) || "any"} and ${toDateInput(rule.endDate ?? null) || "any"}`
                  : "Applied on top of the base price or the season"}
              </div>
            </div>
            <span className="text-sm font-bold text-indigo-600 tabular-nums shrink-0">
              {rule.adjustment != null && rule.adjustment > 0 ? "+" : ""}
              {rule.adjustment}%
            </span>
            <button onClick={() => setEditing(true)} aria-label="Edit weekend pricing" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => onRemove(rule.id)} aria-label="Remove weekend pricing" className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )
      )}
    </Card>
  );
}

function OverridesCard({
  overrides,
  currency,
  onRemove,
}: {
  overrides: PricingRule[];
  currency: string;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card step="4" title="Calendar overrides" hint="Dates you priced by hand. Beats everything above.">
      {overrides.length === 0 ? (
        <p className="text-sm text-slate-400">
          None yet. Click dates on the{" "}
          <Link href="/pricing/calendar" className="text-indigo-600 hover:underline">calendar</Link> to set a
          price for specific nights.
        </p>
      ) : (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-700"
          >
            <ChevronDown className={`w-4 h-4 transition ${open ? "rotate-180" : ""}`} />
            {overrides.length} override{overrides.length === 1 ? "" : "s"}
          </button>
          {open && (
            <div className="space-y-2 mt-3">
              {overrides.map((o) => (
                <div key={o.id} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0 text-xs text-slate-600 tabular-nums truncate">
                    {o.name.replace(MANUAL_PREFIX, "").trim()}
                    {o.minNights && o.minNights > 1 ? ` · min ${o.minNights}` : ""}
                  </div>
                  <span className="text-sm font-semibold text-slate-800 tabular-nums shrink-0">
                    {currency} {o.price}
                  </span>
                  <button onClick={() => onRemove(o.id)} aria-label="Remove override" className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AdvancedCard({
  rules,
  currency,
  onRemove,
}: {
  rules: PricingRule[];
  currency: string;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 w-full text-left">
        <ChevronDown className={`w-4 h-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
        <div>
          <h2 className="font-semibold text-slate-700 text-sm">
            Advanced &mdash; {rules.length} rule{rules.length === 1 ? "" : "s"} that don&apos;t fit the four above
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Still applied exactly as before. Shown here so nothing is hidden.
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-2 mt-4">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{r.name}</div>
                <div className="text-xs text-slate-500">{describeRule(r as never, currency)}</div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                {CONCEPT_LABEL[classifyRule(r as never) as Concept]}
              </span>
              <button onClick={() => onRemove(r.id)} aria-label={`Delete ${r.name}`} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
