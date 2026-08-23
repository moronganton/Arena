"use client";
import { useState, useEffect, useCallback } from "react";
import { CreditCard, Copy, Check, RefreshCw, Landmark, Wallet } from "lucide-react";

interface CityTaxCharge {
  id: string;
  amountCents: number;
  currency: string;
  nights: number;
  guests: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

interface GuestCard {
  status: string; // PENDING | SAVED | FAILED
  cardBrand: string | null;
  cardLast4: string | null;
}

interface ChannexTransaction {
  id: string;
  type: string;
  amount: string;
  currency: string;
  inserted_at: string;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

// Guest-facing payment collection for one reservation: the standalone Stripe
// city tax link (works for every property regardless of channel manager),
// and - only when this reservation genuinely has a Channex booking to charge
// against - a card-charge action through Channex's Payment API.
export default function PaymentsCard({
  reservationId,
  channexEligible,
  currency,
}: {
  reservationId: string;
  channexEligible: boolean;
  currency: string;
}) {
  const [cityTax, setCityTax] = useState<{ configured: boolean; quote: { amountCents: number; nights: number; guests: number; currency: string; description: string } | null; charges: CityTaxCharge[]; card: GuestCard | null } | null>(null);
  const [cityTaxBusy, setCityTaxBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [cityTaxError, setCityTaxError] = useState<string | null>(null);

  const [cardBusy, setCardBusy] = useState(false);
  const [cardLink, setCardLink] = useState<string | null>(null);
  const [cardLinkCopied, setCardLinkCopied] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [chargeCardAmount, setChargeCardAmount] = useState("");
  const [chargeCardDesc, setChargeCardDesc] = useState("");
  const [chargingCard, setChargingCard] = useState(false);
  const [cardChargeMsg, setCardChargeMsg] = useState("");

  const [channexTx, setChannexTx] = useState<ChannexTransaction[] | null>(null);
  const [channexBusy, setChannexBusy] = useState(false);
  const [channexError, setChannexError] = useState<string | null>(null);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeDesc, setChargeDesc] = useState("");

  const loadCityTax = useCallback(() => {
    fetch(`/api/city-tax?reservationId=${reservationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCityTax(d))
      .catch(() => {});
  }, [reservationId]);

  const loadChannexTx = useCallback(() => {
    if (!channexEligible) return;
    fetch(`/api/channex/payments?reservationId=${reservationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setChannexTx(d.transactions ?? []))
      .catch(() => {});
  }, [reservationId, channexEligible]);

  useEffect(() => {
    loadCityTax();
    loadChannexTx();
  }, [loadCityTax, loadChannexTx]);

  async function sendCityTaxLink() {
    setCityTaxBusy(true);
    setCityTaxError(null);
    try {
      const res = await fetch("/api/city-tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create payment link");
      setLastLink(data.url);
      loadCityTax();
    } catch (err) {
      setCityTaxError(err instanceof Error ? err.message : "Failed to create payment link");
    } finally {
      setCityTaxBusy(false);
    }
  }

  function copyLink() {
    if (!lastLink) return;
    navigator.clipboard.writeText(lastLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  // Save-a-card-now, charge-it-later - independent of Channex, works for
  // any property regardless of channel manager. See lib/city-tax.ts.
  async function sendCardLink() {
    setCardBusy(true);
    setCardError(null);
    try {
      const res = await fetch("/api/city-tax/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create card link");
      setCardLink(data.url);
      loadCityTax();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to create card link");
    } finally {
      setCardBusy(false);
    }
  }

  function copyCardLink() {
    if (!cardLink) return;
    navigator.clipboard.writeText(cardLink).then(() => {
      setCardLinkCopied(true);
      setTimeout(() => setCardLinkCopied(false), 2000);
    });
  }

  async function chargeSavedCard() {
    const amountCents = Math.round(parseFloat(chargeCardAmount) * 100);
    if (!chargeCardAmount || !Number.isFinite(amountCents) || amountCents <= 0) return;
    setChargingCard(true);
    setCardError(null);
    setCardChargeMsg("");
    try {
      const res = await fetch("/api/city-tax/card", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, amountCents, description: chargeCardDesc || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Charge failed");
      setChargeCardAmount("");
      setChargeCardDesc("");
      setCardChargeMsg(`Charged ${money(data.charge.amountCents, data.charge.currency)} ✓`);
      loadCityTax();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Charge failed");
    } finally {
      setChargingCard(false);
    }
  }

  async function chargeCard() {
    if (!chargeAmount) return;
    setChannexBusy(true);
    setChannexError(null);
    try {
      const res = await fetch("/api/channex/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, action: "charge", amount: chargeAmount, description: chargeDesc || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Charge failed");
      setChargeAmount("");
      setChargeDesc("");
      loadChannexTx();
    } catch (err) {
      setChannexError(err instanceof Error ? err.message : "Charge failed");
    } finally {
      setChannexBusy(false);
    }
  }

  const latestCharge = cityTax?.charges[0];
  const cityTaxPaid = latestCharge?.status === "PAID";

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-4">
        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
        Payments
      </h3>

      {/* City tax */}
      <div className="mb-4">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
          <Landmark className="w-3.5 h-3.5 text-slate-400" />
          City tax
        </div>
        {!cityTax ? (
          <p className="text-xs text-slate-400">Loading&hellip;</p>
        ) : !cityTax.configured ? (
          <p className="text-xs text-slate-400">No city tax rate set for this property.</p>
        ) : (
          <>
            {cityTax.quote && (
              <p className="text-xs text-slate-500 mb-2">
                Suggested: {money(cityTax.quote.amountCents, cityTax.quote.currency)} ({cityTax.quote.description})
              </p>
            )}
            {latestCharge && (
              <div
                className={`mb-2 text-xs px-2.5 py-1.5 rounded-lg border ${
                  cityTaxPaid ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"
                }`}
              >
                {cityTaxPaid
                  ? `Paid ${money(latestCharge.amountCents, latestCharge.currency)}${latestCharge.paidAt ? ` on ${new Date(latestCharge.paidAt).toLocaleDateString()}` : ""}`
                  : `Link sent, not paid yet - ${money(latestCharge.amountCents, latestCharge.currency)}`}
              </div>
            )}
            {!cityTaxPaid && (
              <div className="flex items-center gap-2">
                <button
                  onClick={sendCityTaxLink}
                  disabled={cityTaxBusy}
                  className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${cityTaxBusy ? "animate-spin" : ""}`} />
                  {latestCharge ? "Resend link" : "Send payment link"}
                </button>
                {lastLink && (
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-3 py-1.5 rounded-lg transition"
                  >
                    {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {linkCopied ? "Copied" : "Copy link"}
                  </button>
                )}
              </div>
            )}
            {cityTaxError && <p className="mt-1.5 text-xs text-red-600">{cityTaxError}</p>}
          </>
        )}
      </div>

      {/* Save a card, charge later - works regardless of channel manager or
          whether a per-night city tax rate is even set, since the amount is
          decided at charge time, not at save time. */}
      {cityTax && (
        <div className="mb-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
            <Wallet className="w-3.5 h-3.5 text-slate-400" />
            Card on file
          </div>
          {cityTax.card?.status === "SAVED" ? (
            <>
              <p className="text-xs text-slate-500 mb-2">
                {cityTax.card.cardBrand ? `${cityTax.card.cardBrand} ` : ""}•••• {cityTax.card.cardLast4 || "····"} — ready to charge, guest not needed.
              </p>
              <div className="flex gap-2">
                <input
                  value={chargeCardAmount}
                  onChange={(e) => setChargeCardAmount(e.target.value)}
                  placeholder={`Amount (${currency})`}
                  inputMode="decimal"
                  className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={chargeSavedCard}
                  disabled={chargingCard || !chargeCardAmount}
                  className="text-xs font-medium bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {chargingCard ? "Charging…" : "Charge"}
                </button>
              </div>
              <input
                value={chargeCardDesc}
                onChange={(e) => setChargeCardDesc(e.target.value)}
                placeholder="Description (optional)"
                className="mt-1.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {cardChargeMsg && <p className="mt-1.5 text-xs text-emerald-600">{cardChargeMsg}</p>}
            </>
          ) : (
            <>
              {cityTax.card?.status === "PENDING" && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                  Link sent, guest hasn&apos;t saved a card yet.
                </p>
              )}
              <p className="text-xs text-slate-400 mb-2">
                Send a link to save the guest&apos;s card now - charge the exact amount later, no need to reach them again.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={sendCardLink}
                  disabled={cardBusy}
                  className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${cardBusy ? "animate-spin" : ""}`} />
                  {cityTax.card ? "Resend card link" : "Send card link"}
                </button>
                {cardLink && (
                  <button
                    onClick={copyCardLink}
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-3 py-1.5 rounded-lg transition"
                  >
                    {cardLinkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {cardLinkCopied ? "Copied" : "Copy link"}
                  </button>
                )}
              </div>
            </>
          )}
          {cardError && <p className="mt-1.5 text-xs text-red-600">{cardError}</p>}
        </div>
      )}

      {/* Channex card charge */}
      {channexEligible && (
        <div className="pt-4 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-700 mb-2">Charge card (via Channex)</p>
          {channexTx && channexTx.length > 0 && (
            <div className="mb-2 space-y-1">
              {channexTx.map((t) => (
                <div key={t.id} className="flex justify-between text-xs text-slate-500">
                  <span className="capitalize">{t.type.replace("_", " ")}</span>
                  <span className="font-medium text-slate-700">{money(Math.round(parseFloat(t.amount) * 100), t.currency)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              inputMode="decimal"
              className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={chargeCard}
              disabled={channexBusy || !chargeAmount}
              className="text-xs font-medium bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
            >
              {channexBusy ? "Charging…" : "Charge"}
            </button>
          </div>
          <input
            value={chargeDesc}
            onChange={(e) => setChargeDesc(e.target.value)}
            placeholder="Description (optional)"
            className="mt-1.5 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {channexError && <p className="mt-1.5 text-xs text-red-600">{channexError}</p>}
        </div>
      )}
    </div>
  );
}
