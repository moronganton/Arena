"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowDown, CalendarDays, Loader2, Pencil, Settings2, X } from "lucide-react";
import RatePlansPanel from "@/components/properties/RatePlansPanel";
import PriceCalendarPanel, { type PriceCalendarProperty } from "@/components/pricing/PriceCalendarPanel";
import ChannelOffersPanel from "@/components/properties/ChannelOffersPanel";
import RatePlanSetup from "@/components/properties/RatePlanSetup";
import ChannexMappingFrame from "@/components/channels/ChannexMappingFrame";
import type { ChannelKey, PlanLike } from "@/lib/channels/channel-offers";

// The Rate plans tab as cause and effect, side by side.
//
// The two layers of the revenue model meet on this screen and nowhere else:
// pricing rules resolve to ONE number per night (the cause, left), and that
// number is what the whole plan family derives from (the effect, right). They
// used to live on different pages - the rules on /pricing, the plans on this
// tab - which is exactly why the link between them stayed invisible. The
// connector between the columns is the point of the layout, not decoration.

interface RuleRow {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: string | null;
  price: number | null;
  adjustment: number | null;
  adjType: string | null;
  minNights: number | null;
  priority: number;
}

interface Summary {
  currency: string;
  basePrice: number;
  rules: RuleRow[];
  plans: PlanLike[];
  // null means Channex could not be reached to check - the panel renders that
  // differently from "nothing is connected".
  connectedChannels: ChannelKey[] | null;
  week: { date: string; dow: string; price: number; minStay: number }[];
}

function ruleValue(r: RuleRow, currency: string): string {
  if (r.price !== null) return `${currency} ${r.price}`;
  if (r.adjustment !== null) {
    const sign = r.adjustment > 0 ? "+" : "";
    return r.adjType === "FIXED" ? `${sign}${r.adjustment} ${currency}` : `${sign}${r.adjustment}%`;
  }
  return "—";
}

function rulePeriod(r: RuleRow): string {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parts: string[] = [];
  if (r.startDate || r.endDate) parts.push(`${r.startDate ?? "…"} → ${r.endDate ?? "…"}`);
  else parts.push("always");
  if (r.daysOfWeek) {
    try {
      const days = JSON.parse(r.daysOfWeek) as number[];
      if (Array.isArray(days) && days.length > 0 && days.length < 7) {
        parts.push(days.map((d) => DOW[d]).join(" "));
      }
    } catch {
      // malformed day list - omit rather than crash the panel over a label
    }
  }
  if (r.minNights && r.minNights > 1) parts.push(`min ${r.minNights}`);
  return parts.join(" · ");
}

export default function RateRevenueTab({
  propertyId,
  propertyName,
  calendarProperty,
  needsChannexSetup = false,
  alreadyFlaggedChannex = false,
}: {
  propertyId: string;
  propertyName: string;
  // When provided, the live price calendar renders full-width below the
  // cause/effect columns - the month view is the same rules made visible
  // thirty days at a time instead of seven.
  calendarProperty?: PriceCalendarProperty;
  // No Channex listing exists yet, so nothing Channex-shaped can be fetched
  // for it - setup runs before any of the usual reads.
  needsChannexSetup?: boolean;
  // Flagged CHANNEX already: the flag flip is a no-op and only provisioning
  // is missing, so the setup step says "finish" rather than "connect".
  alreadyFlaggedChannex?: boolean;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bumped after setup creates the family, to re-read the summary.
  const [reloadKey, setReloadKey] = useState(0);

  // Re-running the import on a property that ALREADY has plans. The setup
  // screen used to be reachable only when a property had none, which put the
  // channel import in the one situation where it cannot work: a brand new
  // property has no OTA connected yet, while an established one - the only
  // kind with a structure worth importing - could not reach it at all.
  const [reimporting, setReimporting] = useState(false);

  // Opened from a "connect this channel" chip. Closing it re-reads the
  // summary, so the chip it was opened from becomes a real badge without a
  // manual refresh.
  const [mapping, setMapping] = useState(false);

  useEffect(() => {
    if (needsChannexSetup) return;
    let cancelled = false;
    setSummary(null);
    setError(null);
    fetch(`/api/pricing/summary?propertyId=${propertyId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        return d as Summary;
      })
      .then((d) => {
        if (!cancelled) setSummary(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load pricing");
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, reloadKey, needsChannexSetup]);

  // The week's floor price, so nights lifted by a rule (weekend, season) read
  // as elevated at a glance without inventing a weekend concept here.
  const floor = summary ? Math.min(...summary.week.map((d) => d.price)) : 0;
  const todayPrice = summary?.week[0]?.price;

  // Rules are hidden until they have earned their place. A property that
  // already has some has clearly found them, so they stay open; a brand new
  // one meets its rate plans first and nothing else - neither Booking.com nor
  // Airbnb has taught this operator what a pricing rule is, and asking them to
  // learn one while they are still working out what a rate plan is loses them.
  const hasRules = (summary?.rules.length ?? 0) > 0;
  const [rulesOpen, setRulesOpen] = useState<boolean | null>(null);
  const showRules = rulesOpen ?? hasRules;

  // A property with no rate plans cannot be finished from this screen until it
  // has some, so setup is the whole tab rather than a card among others.
  if (needsChannexSetup || reimporting || (summary && summary.plans.length === 0)) {
    return (
      <div>
        {reimporting && (
          <button
            onClick={() => setReimporting(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 mb-3"
          >
            <X className="w-3.5 h-3.5" />
            Keep the rate plans I have
          </button>
        )}
        <RatePlanSetup
          propertyId={propertyId}
          propertyName={propertyName}
          currency={summary?.currency ?? "EUR"}
          needsConnecting={needsChannexSetup && !reimporting}
          alreadyFlagged={alreadyFlaggedChannex}
          replacing={reimporting}
          // A full reload: connecting changes channelProvider on the server, so
          // the page's own props are stale until it re-renders.
          onCreated={() => {
            if (needsChannexSetup && !reimporting) {
              window.location.reload();
              return;
            }
            setReimporting(false);
            setReloadKey((n) => n + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
    <div className={`grid grid-cols-1 gap-4 items-start ${showRules ? "lg:grid-cols-[1fr_auto_1fr]" : ""}`}>
      {showRules && (
        <>
        {/* ---- Cause ---- */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Cause — your rules
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              <Pencil className="w-3 h-3" />
              Edit rules
            </Link>
            <Link
              href="/pricing/calendar"
              className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              <CalendarDays className="w-3 h-3" />
              Calendar
            </Link>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        ) : !summary ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading rules…
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {summary.rules.length === 0 && (
                <p className="text-sm text-slate-500">
                  No pricing rules yet — every night sells at the base price of {summary.currency}{" "}
                  {summary.basePrice}.
                </p>
              )}
              {summary.rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{r.name}</div>
                    <div className="text-[11px] text-slate-500">{rulePeriod(r)}</div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-indigo-600 shrink-0">
                    {ruleValue(r, summary.currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Next 7 nights resolve to
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {summary.week.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date} · min stay ${d.minStay}`}
                  className={`rounded-lg border px-1 py-1.5 text-center ${
                    d.price > floor
                      ? "bg-indigo-50 border-indigo-100"
                      : "bg-slate-50 border-slate-100"
                  }`}
                >
                  <div className="text-[9px] font-bold uppercase text-slate-400">{d.dow}</div>
                  <div className="text-[11px] font-semibold tabular-nums text-slate-800">
                    {Math.round(d.price)}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Rules never leave host24 — only these resolved numbers are pushed to your channels.
            </p>
          </>
        )}
      </div>
        </>
      )}

      {showRules && (
        <>
          {/* ---- Connector ---- */}
          <div className="hidden lg:flex flex-col items-center justify-center gap-1.5 pt-16 px-1">
            <ArrowRight className="w-7 h-7 text-indigo-600" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 text-center leading-tight">
              flows
              <br />
              into
            </span>
          </div>
          <div className="flex lg:hidden items-center justify-center gap-2 -my-1">
            <ArrowDown className="w-5 h-5 text-indigo-600" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">flows into</span>
          </div>
        </>
      )}

      {/* ---- Effect ---- */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-slate-900">
            {showRules ? "Effect — what sells" : "What this property sells"}
          </h3>
          <AdvancedPricingToggle open={showRules} onToggle={() => setRulesOpen(!showRules)} />
        </div>
        <RatePlansPanel
          propertyId={propertyId}
          previewBase={todayPrice}
          previewCurrency={summary?.currency}
          showChannelChips
          connectedChannels={summary?.connectedChannels}
          onConnect={() => setMapping(true)}
          onReimport={() => setReimporting(true)}
          onFamilyCleared={() => setReloadKey((n) => n + 1)}
        />
      </div>
    </div>

    {summary && todayPrice !== undefined && (
      <ChannelOffersPanel
        plans={summary.plans}
        parentPrice={todayPrice}
        currency={summary.currency}
        connected={summary.connectedChannels}
      />
    )}

    {mapping && (
      <ChannexMappingFrame
        propertyId={propertyId}
        propertyName={propertyName}
        onClose={() => {
          setMapping(false);
          setReloadKey((n) => n + 1);
        }}
      />
    )}

    {calendarProperty && (
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <h3 className="font-semibold text-slate-900 mb-3">Live prices</h3>
        <PriceCalendarPanel property={calendarProperty} />
      </div>
    )}
    </div>
  );
}

// The gear on "what this property sells", and the only route to pricing rules
// for an operator who has just set the property up.
//
// Its job is not to label a feature but to explain, in the words a host
// already has, that this is capability the OTAs do not give them - and that
// ignoring it costs nothing. Hence the sentence about setting one price at a
// time by hand: it frames rules as something they already lack rather than
// something new to learn, and it happens to be true.
function AdvancedPricingToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [explain, setExplain] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => (open ? onToggle() : setExplain((v) => !v))}
        onMouseEnter={() => !open && setExplain(true)}
        aria-label={open ? "Hide advanced pricing rules" : "Advanced pricing rules"}
        aria-expanded={open}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition ${
          open
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
        }`}
      >
        <Settings2 className="w-3.5 h-3.5" />
        {open ? "Hide rules" : "Advanced pricing rules"}
      </button>

      {explain && !open && (
        <div
          className="absolute right-0 top-full mt-2 w-[19rem] z-20 bg-slate-900 text-slate-100 rounded-xl p-4 shadow-xl"
          onMouseLeave={() => setExplain(false)}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="font-semibold text-white text-sm">Set prices by season, weekend or date</p>
            <button onClick={() => setExplain(false)} aria-label="Close" className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs leading-relaxed mb-2">
            Booking.com and Airbnb let you set one price at a time, by hand. host24 can also change it
            for you — a <strong className="text-white">season</strong>,{" "}
            <strong className="text-white">weekends</strong>, or{" "}
            <strong className="text-white">specific dates</strong> you pick on a calendar.
          </p>
          <p className="text-xs leading-relaxed text-slate-400 mb-3">
            Everything you set feeds your main rate. The other plans follow automatically, because
            each one follows it by a set percentage or amount. Entirely optional — your plans already sell as they are.
          </p>
          <button
            onClick={() => {
              setExplain(false);
              onToggle();
            }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
          >
            Set up pricing rules
          </button>
        </div>
      )}
    </div>
  );
}
