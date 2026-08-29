"use client";
import { useState, useEffect, useCallback } from "react";
import { Layers, AlertTriangle, Check, Loader2, Pencil, Trash2, Plus, X, Download, Archive } from "lucide-react";
import { derivedPriceFor } from "@/lib/channels/rate-plan-spec";

// What this property sells on the OTAs, as opposed to what it charges per night.
//
// Worth being explicit about, because the app now has two things called
// something-Rate and they are different layers:
//
//   Pricing rules (the Pricing page) decide the NUMBER for a given night -
//     base price, weekend uplift, a season, a minimum stay.
//   Rate plans (here) are the PRODUCTS that number is sold as - Standard,
//     non-refundable, weekly, monthly - each with its own length-of-stay rule.
//
// Only one plan is ever pushed to: the parent. The rest are derived from it by
// a percentage that Channex recomputes whenever the parent's price moves, which
// is why a six-product listing still needs exactly one price stream.

interface RatePlan {
  id: string;
  channexRatePlanId: string | null;
  title: string;
  kind: string; // PARENT | DERIVED
  derivedPercent: number | null;
  minStayArrival: number;
  position: number;
  active: boolean;
}

// previewBase is tonight's resolved parent price (from /api/pricing/summary).
// When present, every plan row shows what it actually quotes in currency -
// "-15%" and "€85.00" are the same fact, but only one of them is a price.
export default function RatePlansPanel({
  propertyId,
  previewBase,
  previewCurrency,
  showChannelChips = false,
  onReimport,
}: {
  propertyId: string;
  previewBase?: number;
  previewCurrency?: string;
  // Marks each row with the channels that carry it. Off by default so the
  // panel stays honest wherever channel state isn't known.
  showChannelChips?: boolean;
  // Re-read the family from the channel. Offered here rather than only during
  // first-time setup because importing a channel's structure is not a one-off
  // onboarding gesture - it is what you do again after adding a plan on
  // Booking.com.
  onReimport?: () => void;
}) {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [pushesInto, setPushesInto] = useState<string | null>(null);
  // null means Channex could not be asked, which the panel renders differently
  // from "there are none".
  const [untracked, setUntracked] = useState<{ id: string; title: string }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/channex/rate-plans?propertyId=${propertyId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Couldn't load rate plans");
        return d;
      })
      .then((d) => {
        setPlans(d.ratePlans ?? []);
        setPushesInto(d.pushesInto ?? null);
        setUntracked(d.untracked ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load rate plans"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  useEffect(() => {
    if (propertyId) load();
  }, [propertyId, load]);

  // Every write goes to Channex first and the list is re-read afterwards, so
  // what the panel shows is what Channex actually holds - not what the form
  // hoped it would hold.
  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionError((d.problems ?? []).join("; ") || d.error || "That didn't work");
        return false;
      }
      setEditing(null);
      setAdding(false);
      load();
      return true;
    } catch {
      setActionError("Couldn't reach the server");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading rate plans…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }

  const parent = plans.find((p) => p.kind === "PARENT");
  const derived = plans.filter((p) => p.kind !== "PARENT");

  if (plans.length === 0) {
    return (
      <div className="text-sm text-slate-600 space-y-2">
        <p className="font-medium text-slate-900">No rate plans recorded yet.</p>
        <p>
          This property sells through a single rate plan on Channex. Provisioning a family — a
          standard rate plus non-refundable, weekly and monthly variants — is done from the
          rate-plan API and will appear here once it has run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-slate-600">
        <Layers className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
        <p>
          The products this listing sells. Prices are pushed to the <strong>parent</strong> only —
          every other plan is derived from it by a percentage, so one price stream produces{" "}
          {plans.length} offers.
        </p>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {actionError}
        </div>
      )}

      {parent &&
        (editing === parent.id ? (
          <PlanEditor
            plan={parent}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(body) =>
              send(`/api/channex/rate-plans/${parent.id}`, {
                method: "PATCH",
                body: JSON.stringify({ propertyId, ...body }),
              })
            }
          />
        ) : (
          <PlanRow
            plan={parent}
            isPushTarget={parent.channexRatePlanId === pushesInto}
            preview={previewBase !== undefined && previewCurrency ? { base: previewBase, currency: previewCurrency } : undefined}
            showChannelChips={showChannelChips}
            onEdit={() => { setActionError(null); setEditing(parent.id); }}
          />
        ))}

      {derived.length > 0 && (
        <div className="pl-4 border-l-2 border-slate-100 space-y-2">
          {derived.map((p) =>
            editing === p.id ? (
              <PlanEditor
                key={p.id}
                plan={p}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(body) =>
                  send(`/api/channex/rate-plans/${p.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ propertyId, ...body }),
                  })
                }
              />
            ) : (
              <PlanRow
                key={p.id}
                plan={p}
                isPushTarget={p.channexRatePlanId === pushesInto}
                preview={previewBase !== undefined && previewCurrency ? { base: previewBase, currency: previewCurrency } : undefined}
                showChannelChips={showChannelChips}
                onEdit={() => { setActionError(null); setEditing(p.id); }}
                onDelete={() => {
                  if (!confirm(`Remove "${p.title}"? It stops being sellable on every channel it is mapped to.`)) return;
                  send(`/api/channex/rate-plans/${p.id}?propertyId=${propertyId}`, { method: "DELETE" });
                }}
              />
            )
          )}
        </div>
      )}

      {adding ? (
        <div className="pl-4 border-l-2 border-slate-100">
          <PlanEditor
            plan={{ id: "new", channexRatePlanId: null, title: "", kind: "DERIVED", derivedPercent: -10, minStayArrival: 2, position: 0, active: true }}
            busy={busy}
            isNew
            onCancel={() => setAdding(false)}
            onSave={(body) =>
              send(`/api/channex/rate-plans`, {
                method: "POST",
                body: JSON.stringify({ propertyId, addPlan: body }),
              })
            }
          />
        </div>
      ) : (
        parent && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => { setActionError(null); setAdding(true); }}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 px-3 py-2"
            >
              <Plus className="w-4 h-4" />
              Add a rate plan
            </button>
            {onReimport && (
              <button
                onClick={onReimport}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 px-3 py-2"
              >
                <Download className="w-4 h-4" />
                Re-read from the channel
              </button>
            )}
          </div>
        )
      )}

      {/* Plans still on Channex that this app stopped tracking - what an
          earlier provisioning run retired. Left unlisted they are invisible
          here and unremovable from here, so a property quietly accumulates
          dead plans under "(retired ...)" titles that only the Channex UI
          ever shows. */}
      {untracked && untracked.length > 0 && (
        <div className="border border-slate-200 rounded-xl p-3">
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <Archive className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <p>
              <span className="font-medium text-slate-900">
                {untracked.length} plan{untracked.length === 1 ? "" : "s"} left on Channex
              </span>{" "}
              that host24 no longer sells through — usually replaced by a later import. Removing them
              is safe unless a channel still maps to one.
            </p>
          </div>
          <div className="mt-2 space-y-1">
            {untracked.map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate text-slate-500">{u.title}</span>
                <button
                  onClick={() => {
                    if (!confirm(`Delete "${u.title}" from Channex? This cannot be undone.`)) return;
                    send(`/api/channex/rate-plans/${encodeURIComponent(`channex:${u.id}`)}?propertyId=${propertyId}`, {
                      method: "DELETE",
                    });
                  }}
                  disabled={busy}
                  aria-label={`Delete ${u.title} from Channex`}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {parent && parent.channexRatePlanId !== pushesInto && (
        <div className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Prices are being pushed to a rate plan that isn&apos;t the parent recorded here. That
            usually means a provisioning run didn&apos;t finish — the plans below may not be
            receiving updates.
          </span>
        </div>
      )}
    </div>
  );
}

function PlanRow({
  plan, isPushTarget, onEdit, onDelete, preview, showChannelChips,
}: {
  plan: RatePlan; isPushTarget: boolean; onEdit?: () => void; onDelete?: () => void;
  preview?: { base: number; currency: string };
  showChannelChips?: boolean;
}) {
  const isParent = plan.kind === "PARENT";
  const pct = plan.derivedPercent;
  const quoted = preview ? derivedPriceFor(preview.base, isParent ? null : pct) : null;

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 text-sm">{plan.title}</span>
          {isParent && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
              Parent
            </span>
          )}
          {isPushTarget && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
              <Check className="w-3 h-3" />
              Receives prices
            </span>
          )}
          {!plan.active && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              Inactive
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
          Minimum stay {plan.minStayArrival} {plan.minStayArrival === 1 ? "night" : "nights"}
          {plan.channexRatePlanId && (
            <span className="text-slate-400"> · {plan.channexRatePlanId.slice(0, 8)}</span>
          )}
        </div>
        {/* Airbnb takes exactly one rate plan per listing - the parent's
            mirror - so every derived plan is Booking.com-only. The dashed
            empty slot is deliberate: absence is the information, and a
            missing badge would read as an oversight instead. */}
        {showChannelChips && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border bg-sky-50 text-sky-800 border-sky-200">
              BOOKING
            </span>
            {isParent ? (
              <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200">
                AIRBNB
              </span>
            ) : (
              <span
                title="Airbnb accepts one rate plan per listing - only the parent reaches it"
                className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border border-dashed border-slate-200 text-slate-400"
              >
                &mdash;
              </span>
            )}
          </div>
        )}
      </div>

      <div className="text-right shrink-0">
        {quoted !== null && preview && (
          <div className="text-sm font-bold tabular-nums text-slate-900">
            {preview.currency} {quoted.toFixed(2)}
            <span className="text-[10px] font-medium text-slate-400"> tonight</span>
          </div>
        )}
        {isParent ? (
          <span className="text-xs text-slate-400">from your pricing rules</span>
        ) : (
          <span
            className={`text-xs font-bold tabular-nums ${
              pct !== null && pct < 0 ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {pct !== null && pct < 0
              ? `${Math.abs(pct)}% cheaper than parent`
              : `${pct}% dearer than parent`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onEdit && (
          <button onClick={onEdit} aria-label={`Edit ${plan.title}`}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50">
            <Pencil className="w-4 h-4" />
          </button>
        )}
        {/* No delete on the parent: every other plan derives from it. */}
        {onDelete && (
          <button onClick={onDelete} aria-label={`Remove ${plan.title}`}
            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// The editor for one plan, also used for adding a new one.
//
// The parent's percentage is deliberately absent rather than disabled-and-
// empty: it does not have one, and showing a greyed field implies it could.
function PlanEditor({
  plan, busy, isNew, onCancel, onSave,
}: {
  plan: RatePlan;
  busy: boolean;
  isNew?: boolean;
  onCancel: () => void;
  onSave: (body: { title: string; derivedPercent?: number; minStayArrival: number }) => void;
}) {
  const isParent = plan.kind === "PARENT";
  const [title, setTitle] = useState(plan.title);
  const [pct, setPct] = useState(String(plan.derivedPercent ?? ""));
  const [minStay, setMinStay] = useState(String(plan.minStayArrival));

  const parsedPct = Number(pct);
  const pctValid = isParent || (pct.trim() !== "" && Number.isFinite(parsedPct));

  return (
    <div className="bg-white border-2 border-indigo-200 rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly Rate"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {!isParent && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">% of parent</label>
            <input
              type="number"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="-15"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">Negative discounts, positive surcharges.</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Min. nights</label>
          <input
            type="number"
            min="1"
            value={minStay}
            onChange={(e) => setMinStay(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {isParent && (
        <p className="text-xs text-slate-500">
          The parent&apos;s price comes from your pricing rules — there is no percentage to set here.
          Its minimum stay is overwritten on every push, so change that in the pricing rule instead.
        </p>
      )}

      <div className="flex gap-2">
        <button
          disabled={busy || !title.trim() || !pctValid}
          onClick={() =>
            onSave({
              title: title.trim(),
              ...(isParent ? {} : { derivedPercent: parsedPct }),
              minStayArrival: Number(minStay) || 1,
            })
          }
          className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {isNew ? "Create on Channex" : "Save"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm font-medium px-3 py-2 rounded-lg"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}
