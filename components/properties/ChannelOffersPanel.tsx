"use client";
import { useState } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import {
  ladderLengths,
  offersForStay,
  type ChannelKey,
  type PlanLike,
} from "@/lib/channels/channel-offers";
import { formatCurrency } from "@/lib/utils";

// What a guest actually sees on each channel, for a stay of N nights.
//
// The plan list above this answers "what products exist". It cannot answer
// "what price is displayed where", because that depends on the channel (Airbnb
// takes one rate plan; Booking.com takes the family) AND on the stay length
// (an OTA only offers plans whose minimum the guest satisfies). Rendering the
// two storefronts side by side makes the asymmetry legible before a word is
// read - on a two-night search one card has offers and the other has none.
//
// All arithmetic lives in lib/channels/channel-offers.ts so this component
// cannot drift from the rule that decides it.

const CHANNEL_META: Record<ChannelKey, { label: string; mark: string; text: string; soft: string; border: string }> = {
  BOOKING: { label: "Booking.com", mark: "B.", text: "text-sky-800", soft: "bg-sky-50", border: "border-sky-200" },
  AIRBNB: { label: "Airbnb", mark: "●", text: "text-rose-800", soft: "bg-rose-50", border: "border-rose-200" },
};

function Storefront({
  channel,
  plans,
  parentPrice,
  nights,
  currency,
  otherCheapest,
}: {
  channel: ChannelKey;
  plans: PlanLike[];
  parentPrice: number;
  nights: number;
  currency: string;
  otherCheapest: number | null;
}) {
  const meta = CHANNEL_META[channel];
  const quote = offersForStay(plans, parentPrice, nights, channel);
  const total = quote.cheapest ? quote.cheapest.price * nights : null;
  const otherTotal = otherCheapest != null ? otherCheapest * nights : null;
  const gap = total != null && otherTotal != null ? total - otherTotal : null;

  return (
    <div className={`border rounded-xl overflow-hidden flex flex-col ${meta.border}`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 ${meta.soft}`}>
        <span className={`w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center shrink-0 ${channel === "BOOKING" ? "bg-sky-700" : "bg-rose-600"}`}>
          {meta.mark}
        </span>
        <span className={`text-sm font-bold ${meta.text}`}>{meta.label}</span>
        <span className="ml-auto text-[11px] font-medium text-slate-500 tabular-nums">
          {quote.offers.length === 0
            ? "no offer"
            : `${quote.offers.length} offer${quote.offers.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        {quote.bookable ? (
          quote.offers.map((o, i) => (
            <div
              key={o.title}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
                i === 0 ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-100"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-800 truncate">{o.title}</div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  min {o.minStay} night{o.minStay === 1 ? "" : "s"}
                  {o.derivedPercent !== null ? ` · ${o.derivedPercent > 0 ? "+" : ""}${o.derivedPercent}%` : " · parent"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-slate-900 tabular-nums">
                  {formatCurrency(o.price, currency)}
                </div>
                {i === 0 && (
                  <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                    {quote.offers.length === 1 ? "only offer" : "cheapest"}
                  </div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg border border-dashed border-red-200 bg-red-50">
            <Ban className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold text-red-700">Not bookable on {meta.label}</div>
              <div className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                {quote.shortestStay != null
                  ? `Your minimum here is ${quote.shortestStay} nights. A guest searching ${nights} night${nights === 1 ? "" : "s"} never sees this listing.`
                  : "No plan reaches this channel."}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={`px-3 py-2 border-t text-[11px] ${
          quote.bookable ? "border-slate-100 bg-slate-50 text-slate-600" : "border-red-100 bg-red-50 text-red-700"
        }`}
      >
        {total != null ? (
          <>
            Guest pays <strong className="text-slate-900 tabular-nums">{formatCurrency(total, currency)}</strong> for{" "}
            {nights} night{nights === 1 ? "" : "s"}
            {gap != null && gap > 0 && (
              <>
                {" · "}
                <span className="text-amber-700 font-semibold tabular-nums">
                  {formatCurrency(gap, currency)} more
                </span>
              </>
            )}
          </>
        ) : otherTotal != null ? (
          <>
            The other channel sells this stay at{" "}
            <strong className="tabular-nums">{formatCurrency(otherTotal, currency)}</strong> — here, nothing
          </>
        ) : (
          "Nothing on sale for this stay"
        )}
      </div>
    </div>
  );
}

export default function ChannelOffersPanel({
  plans,
  parentPrice,
  currency,
  connected,
}: {
  plans: PlanLike[];
  parentPrice: number;
  currency: string;
  // null = we could not reach Channex to check. Rendered as an honest
  // "couldn't check" rather than silently implying nothing is connected.
  connected: ChannelKey[] | null;
}) {
  const lengths = ladderLengths(plans);
  // Default to the shortest stay Airbnb cannot sell, when there is one - that
  // is the case an operator is least likely to know about and most likely to
  // be losing money on.
  const airbnbFloor = offersForStay(plans, parentPrice, 1, "AIRBNB").shortestStay;
  const [nights, setNights] = useState<number>(() => {
    const blocked = lengths.find((n) => airbnbFloor != null && n < airbnbFloor);
    return blocked ?? lengths[0] ?? 1;
  });

  if (plans.length === 0) return null;

  const bdc = offersForStay(plans, parentPrice, nights, "BOOKING");
  const abb = offersForStay(plans, parentPrice, nights, "AIRBNB");
  const airbnbConnected = connected === null || connected.includes("AIRBNB");
  const bookingConnected = connected === null || connected.includes("BOOKING");

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 mt-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h3 className="font-semibold text-slate-900">What a guest sees</h3>
        <span className="text-[11px] text-slate-400">
          Tonight&apos;s price, {formatCurrency(parentPrice, currency)} on the parent
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Each channel offers only the plans whose minimum the guest satisfies, cheapest first — so the
        answer changes with the length of the stay.
      </p>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {lengths.map((n) => (
          <button
            key={n}
            onClick={() => setNights(n)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              n === nights
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {n} night{n === 1 ? "" : "s"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Storefront
          channel="BOOKING"
          plans={plans}
          parentPrice={parentPrice}
          nights={nights}
          currency={currency}
          otherCheapest={abb.cheapest?.price ?? null}
        />
        <Storefront
          channel="AIRBNB"
          plans={plans}
          parentPrice={parentPrice}
          nights={nights}
          currency={currency}
          otherCheapest={bdc.cheapest?.price ?? null}
        />
      </div>

      {/* Airbnb keeps its own length-of-stay discounts on the listing - they
          are not synced from these rate plans and host24 cannot read them
          yet, so the panel names the gap instead of quoting a price it does
          not actually know. */}
      {airbnbConnected && abb.bookable && nights >= 7 && (
        <div className="mt-3 flex items-start gap-2 text-xs px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Airbnb may apply its own <strong>weekly or monthly stay discount</strong> on top of this. That
            setting lives on the Airbnb listing, not in your rate plans, so the real guest price there can be
            lower than shown.
          </span>
        </div>
      )}

      {connected !== null && (!airbnbConnected || !bookingConnected) && (
        <p className="mt-3 text-[11px] text-slate-500">
          {!airbnbConnected && !bookingConnected
            ? "Neither Booking.com nor Airbnb is connected to this property yet — these are the offers they would carry."
            : !airbnbConnected
              ? "Airbnb isn't connected to this property yet — that column shows what it would carry."
              : "Booking.com isn't connected to this property yet — that column shows what it would carry."}
        </p>
      )}
      {connected === null && (
        <p className="mt-3 text-[11px] text-slate-400">
          Couldn&apos;t check which channels are connected right now — the offers above assume both.
        </p>
      )}

      <details className="mt-4">
        <summary className="text-xs font-semibold text-slate-600 cursor-pointer hover:text-slate-900">
          Every stay length at once
        </summary>
        <div className="overflow-x-auto mt-2 border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left font-semibold text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2">Stay</th>
                <th className="text-left font-semibold text-[10px] uppercase tracking-wider text-sky-800 px-3 py-2">Booking.com</th>
                <th className="text-left font-semibold text-[10px] uppercase tracking-wider text-rose-800 px-3 py-2">Airbnb</th>
              </tr>
            </thead>
            <tbody>
              {lengths.map((n) => {
                const b = offersForStay(plans, parentPrice, n, "BOOKING");
                const a = offersForStay(plans, parentPrice, n, "AIRBNB");
                return (
                  <tr key={n} className={`border-b border-slate-100 last:border-0 ${a.bookable ? "" : "bg-red-50"}`}>
                    <td className="px-3 py-2 font-semibold tabular-nums whitespace-nowrap">
                      {n} night{n === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-2">
                      {b.cheapest ? (
                        <>
                          <span className="font-semibold tabular-nums">{formatCurrency(b.cheapest.price, currency)}</span>{" "}
                          <span className="text-xs text-slate-500">{b.cheapest.title}</span>
                        </>
                      ) : (
                        <span className="text-xs text-red-700 font-semibold">not bookable</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {a.cheapest ? (
                        <>
                          <span className="font-semibold tabular-nums">{formatCurrency(a.cheapest.price, currency)}</span>{" "}
                          <span className="text-xs text-slate-500">
                            {a.cheapest.title}
                            {n >= 7 ? " + their LOS discount" : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-red-700 font-semibold">not bookable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
