"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Landmark, Check, Clock, X, AlertTriangle, Info, Settings2 } from "lucide-react";

interface Charge {
  id: string;
  amountCents: number;
  currency: string;
  nights: number;
  guests: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  reservation: {
    id: string;
    checkIn: string;
    checkOut: string;
    guest: { name: string };
    property: { name: string };
  };
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  PAID: { label: "Paid", cls: "bg-emerald-100 text-emerald-700", icon: Check },
  PENDING: { label: "Pending", cls: "bg-amber-100 text-amber-700", icon: Clock },
  CANCELED: { label: "Canceled", cls: "bg-slate-100 text-slate-500", icon: X },
  // An auto-charge attempt that failed (e.g. the bank needed the guest
  // present to re-authenticate) - deliberately distinct from PENDING, which
  // means "a link is out, still waiting on the guest." This means "needs a
  // host to look at it," not "still in progress."
  FAILED: { label: "Needs attention", cls: "bg-rose-100 text-rose-700", icon: AlertTriangle },
  // Auto-charge deliberately held back because a Channex payment already
  // exists on this booking - not a failure, a "please check this by hand"
  // flag so the guest is never charged city tax twice.
  SKIPPED: { label: "Check Channex charges", cls: "bg-blue-100 text-blue-700", icon: Info },
};

// The "always see who paid or not, so I can follow up" view the manual bank
// transfer process couldn't provide - every city tax link ever sent, across
// every property, newest first.
export default function CityTaxPage() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/city-tax")
      .then((r) => r.json())
      .then((d) => setCharges(d.charges ?? []))
      .finally(() => setLoading(false));
  }, []);

  const pending = charges.filter((c) => c.status === "PENDING");
  const paidTotal = charges.filter((c) => c.status === "PAID").reduce((sum, c) => sum + c.amountCents, 0);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-slate-400" />
            City tax
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Every payment link sent, and whether the guest has actually paid.
          </p>
        </div>
        <Link
          href="/properties"
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-3 py-2 rounded-xl transition shrink-0"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Rate &amp; listing settings live on each property
        </Link>
      </div>

      {!loading && charges.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500">Awaiting payment</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{pending.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500">Collected</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {money(paidTotal, charges[0]?.currency || "EUR")}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-6">Loading&hellip;</p>
        ) : charges.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">No city tax charges yet.</p>
            <p className="text-xs mt-1">Send a link from a reservation&apos;s Payments card once a property has a rate set.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {charges.map((c) => {
              const status = STATUS_STYLE[c.status] ?? STATUS_STYLE.PENDING;
              const Icon = status.icon;
              return (
                <Link
                  key={c.id}
                  href={`/reservations/${c.reservation.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{c.reservation.guest.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.reservation.property.name} &middot; {c.nights} night(s) &middot; {c.guests} guest(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-slate-900">{money(c.amountCents, c.currency)}</span>
                    <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${status.cls}`}>
                      <Icon className="w-3 h-3" />
                      {status.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
