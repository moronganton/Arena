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
  derivedAmount: number | null;
  mealType: string | null;
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
  connectedChannels,
  onConnect,
  onReimport,
  onFamilyCleared,
}: {
  propertyId: string;
  previewBase?: number;
  previewCurrency?: string;
  // Marks each row with the channels that carry it. Off by default so the
  // panel stays honest wherever channel state isn't known.
  showChannelChips?: boolean;
  // Which OTAs actually sell this property, from Channex. The chips used to be
  // static: every parent claimed AIRBNB whether or not Airbnb had ever been
  // connected, so the panel asserted a channel the operator had not set up.
  // null means it could not be determined, and nothing is claimed either way.
  connectedChannels?: string[] | null;
  /** Opens the channel mapping window from a chip offering to connect one. */
  onConnect?: () => void;
  // Re-read the family from the channel. Offered here rather than only during
  // first-time setup because importing a channel's structure is not a one-off
  // onboarding gesture - it is what you do again after adding a plan on
  // Booking.com.
  onReimport?: () => void;
  // Clearing the family changes what the TAB should render - setup rather than
  // this panel - and that decision is made from a different endpoint, so
  // re-reading this panel alone would leave the operator looking at an empty
  // list instead of the setup screen they just asked for.
  onFamilyCleared?: () => void;
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
          This property sells through a single rate plan. Provisioning a family — a
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
          every other plan follows it by a percentage or a fixed amount, so one price stream produces{" "}
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
            currency={previewCurrency}
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
            connectedChannels={connectedChannels}
            onConnect={onConnect}
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
                currency={previewCurrency}
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
                connectedChannels={connectedChannels}
                onConnect={onConnect}
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
            plan={{ id: "new", channexRatePlanId: null, title: "", kind: "DERIVED", derivedPercent: -10, derivedAmount: null, mealType: null, minStayArrival: 2, position: 0, active: true }}
            busy={busy}
            currency={previewCurrency}
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
            {/* Clearing the family, as opposed to removing one plan. The
                parent has no delete of its own because everything derives
                from it and it is the plan prices are pushed into - so the
                only honest way to undo a bad import is to say plainly that
                this removes all of them and starts setup again. */}
            <button
              onClick={() => {
                if (
                  !confirm(
                    `Remove all ${plans.length} rate plans from this property?\n\n` +
                      `The derived plans are deleted. Your main rate keeps receiving ` +
                      `prices, and setup starts again so you can import or build a new set.`
                  )
                )
                  return;
                send(`/api/channex/rate-plans`, {
                  method: "POST",
                  body: JSON.stringify({ propertyId, resetFamily: true }),
                }).then((ok) => {
                  if (ok) onFamilyCleared?.();
                });
              }}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-red-600 px-3 py-2 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              Remove all and start over
            </button>
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
                {untracked.length} plan{untracked.length === 1 ? "" : "s"} no longer used
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
                    if (!confirm(`Delete "${u.title}"? This cannot be undone.`)) return;
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
  plan, isPushTarget, onEdit, onDelete, preview, showChannelChips, connectedChannels, onConnect,
}: {
  plan: RatePlan; isPushTarget: boolean; onEdit?: () => void; onDelete?: () => void;
  preview?: { base: number; currency: string };
  showChannelChips?: boolean;
  // Which OTAs actually sell this property, from Channex. The chips used to be
  // static: every parent claimed AIRBNB whether or not Airbnb had ever been
  // connected, so the panel asserted a channel the operator had not set up.
  // null means it could not be determined, and nothing is claimed either way.
  connectedChannels?: string[] | null;
  /** Opens the mapping window, for a chip offering to connect a channel. */
  onConnect?: () => void;
}) {
  const isParent = plan.kind === "PARENT";
  // null means Channex could not be asked. Treated as connected so an outage
  // never invites someone to reconnect a channel they already have.
  const bookingConnected = connectedChannels === null || connectedChannels === undefined
    ? true
    : connectedChannels.includes("BOOKING");
  const airbnbConnected = connectedChannels === null || connectedChannels === undefined
    ? true
    : connectedChannels.includes("AIRBNB");
  const pct = plan.derivedPercent;
  const quoted = preview
    ? derivedPriceFor(preview.base, isParent ? null : { derivedPercent: plan.derivedPercent, derivedAmount: plan.derivedAmount })
    : null;

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
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {/* A chip is a claim that this plan sells somewhere. It used to be
                static, so every parent asserted AIRBNB whether or not Airbnb
                had ever been connected - a property live on Booking.com alone
                looked like it was selling on both. A channel that is not
                connected is now an invitation to connect it, not a badge. */}
            {bookingConnected ? (
              <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border bg-sky-50 text-sky-800 border-sky-200">
                BOOKING
              </span>
            ) : isParent && onConnect ? (
              <button
                onClick={onConnect}
                className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border border-dashed border-sky-200 text-sky-600 hover:bg-sky-50"
              >
                CONNECT BOOKING.COM
              </button>
            ) : null}

            {airbnbConnected ? (
              isParent ? (
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
              )
            ) : isParent && onConnect ? (
              <button
                onClick={onConnect}
                className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border border-dashed border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                CONNECT AIRBNB.COM
              </button>
            ) : null}
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
            {plan.derivedAmount !== null && plan.derivedAmount !== undefined
              ? plan.derivedAmount < 0
                ? `${preview?.currency ?? ""} ${Math.abs(plan.derivedAmount)} cheaper than parent`.trim()
                : `${preview?.currency ?? ""} ${plan.derivedAmount} dearer than parent`.trim()
              : pct !== null && pct < 0
                ? `${Math.abs(pct)}% cheaper than parent`
                : `${pct}% dearer than parent`}
          </span>
        )}
      </div>

      {plan.mealType === "breakfast" && (
        <span
          title="Breakfast is included in this rate"
          className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 self-center shrink-0"
        >
          BREAKFAST
        </span>
      )}

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
  plan, busy, isNew, onCancel, onSave, currency,
}: {
  plan: RatePlan;
  /** Shown on the amount option, so the unit is the property's own money. */
  currency?: string;
  busy: boolean;
  isNew?: boolean;
  onCancel: () => void;
  onSave: (body: {
    title: string;
    derivedPercent?: number | null;
    derivedAmount?: number | null;
    minStayArrival: number;
    mealType?: string | null;
  }) => void;
}) {
  const isParent = plan.kind === "PARENT";
  const [title, setTitle] = useState(plan.title);
  // Percent or a flat amount, the same two Booking.com's own "Price
  // difference" control offers. A plan holds exactly one, so the toggle picks
  // which field the value means rather than showing two boxes to fill.
  const [unit, setUnit] = useState<"percent" | "amount">(
    plan.derivedAmount !== null && plan.derivedAmount !== undefined ? "amount" : "percent"
  );
  const [diff, setDiff] = useState(
    String((plan.derivedAmount ?? plan.derivedPercent) ?? "")
  );
  const [minStay, setMinStay] = useState(String(plan.minStayArrival));
  const [breakfast, setBreakfast] = useState(plan.mealType === "breakfast");

  const parsedDiff = Number(diff);
  const diffValid = isParent || (diff.trim() !== "" && Number.isFinite(parsedDiff));

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
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Cheaper / dearer than the main rate
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                placeholder={unit === "amount" ? "12" : "-15"}
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as "percent" | "amount")}
                aria-label="Price difference unit"
                className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="percent">%</option>
                <option value="amount">{currency ?? "EUR"}</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Negative is cheaper, positive is dearer.{" "}
              {unit === "amount"
                ? "A fixed amount stays the same whatever the night costs — right for breakfast."
                : "A percentage moves with the price."}
            </p>
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

      {!isParent && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={breakfast}
            onChange={(e) => setBreakfast(e.target.checked)}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Breakfast is included in this rate
        </label>
      )}

      {isParent && (
        <p className="text-xs text-slate-500">
          The parent&apos;s price comes from your pricing rules — there is no percentage to set here.
          Its minimum stay is overwritten on every push, so change that in the pricing rule instead.
        </p>
      )}

      <div className="flex gap-2">
        <button
          disabled={busy || !title.trim() || !diffValid}
          onClick={() =>
            onSave({
              title: title.trim(),
              // Exactly one of these is sent; the server clears the other, so a
              // plan switched from a percent to an amount does not keep a
              // stale percent behind it.
              ...(isParent
                ? {}
                : unit === "amount"
                  ? { derivedAmount: parsedDiff }
                  : { derivedPercent: parsedDiff }),
              minStayArrival: Number(minStay) || 1,
              ...(isParent ? {} : { mealType: breakfast ? "breakfast" : "none" }),
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
