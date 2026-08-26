"use client";
import { useState, useEffect, useCallback } from "react";
import { Layers, AlertTriangle, Check, Loader2 } from "lucide-react";

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

export default function RatePlansPanel({ propertyId }: { propertyId: string }) {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [pushesInto, setPushesInto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load rate plans"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  useEffect(() => {
    if (propertyId) load();
  }, [propertyId, load]);

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

      {parent && (
        <PlanRow plan={parent} isPushTarget={parent.channexRatePlanId === pushesInto} />
      )}

      {derived.length > 0 && (
        <div className="pl-4 border-l-2 border-slate-100 space-y-2">
          {derived.map((p) => (
            <PlanRow key={p.id} plan={p} isPushTarget={p.channexRatePlanId === pushesInto} />
          ))}
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

function PlanRow({ plan, isPushTarget }: { plan: RatePlan; isPushTarget: boolean }) {
  const isParent = plan.kind === "PARENT";
  const pct = plan.derivedPercent;

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
      </div>

      <div className="text-right shrink-0">
        {isParent ? (
          <span className="text-xs text-slate-400">from your pricing rules</span>
        ) : (
          <span
            className={`text-sm font-bold tabular-nums ${
              pct !== null && pct < 0 ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {pct !== null && pct > 0 ? "+" : ""}
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
}
