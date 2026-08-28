"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Landmark, ClipboardList, Sparkles, Images, Star, CreditCard, Layers, FolderOpen } from "lucide-react";
import CityTaxSettingsPanel from "@/components/properties/CityTaxSettingsPanel";
import RateRevenueTab from "@/components/properties/RateRevenueTab";
import {
  HotelPolicyPanel,
  FacilitiesPanel,
  PhotosPanel,
  ReviewsPanel,
  PaymentsSetupPanel,
} from "@/components/properties/ListingContentPanels";

// The property page in two tiers.
//
// Primary tabs are the things host24 is actually authoritative over - rate
// plans (the product itself), taxes (the compliance wedge), reviews (the one
// content type genuinely pulled from the OTAs), payments. Hotel policy,
// facilities and photos are real, working panels, but for an already-listed
// property they duplicate what Booking.com and Airbnb hold and cannot fetch
// from them - so they live behind one visually demoted "Listing content" tab
// with the optionality stated outright, instead of five tabs implying five
// obligations.
//
// "Taxes & fees" is the one tab that works for every property regardless of
// channel manager; everything else is Channex-only.
const PRIMARY_TABS = [
  { id: "rateplans", label: "Rate plans", icon: Layers, channexOnly: true },
  { id: "taxes", label: "Taxes & fees", icon: Landmark, channexOnly: false },
  { id: "reviews", label: "Reviews", icon: Star, channexOnly: true },
  { id: "payments", label: "Payments", icon: CreditCard, channexOnly: true },
] as const;

const CONTENT_SUBTABS = [
  { id: "policy", label: "Hotel policy", icon: ClipboardList },
  { id: "facilities", label: "Facilities", icon: Sparkles },
  { id: "photos", label: "Photos", icon: Images },
] as const;

type TabId = (typeof PRIMARY_TABS)[number]["id"] | "content";
type SubTabId = (typeof CONTENT_SUBTABS)[number]["id"];

function PaymentSetupBanner() {
  const params = useSearchParams();
  const status = params.get("paymentSetup");
  if (!status) return null;
  const map: Record<string, { text: string; cls: string }> = {
    connected: { text: "Stripe connected - you can now charge cards for this property.", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
    pending: { text: "Stripe connection didn't finish - try again below.", cls: "bg-amber-50 border-amber-200 text-amber-700" },
    error: { text: "Something went wrong connecting Stripe - try again below.", cls: "bg-red-50 border-red-200 text-red-700" },
  };
  const m = map[status];
  if (!m) return null;
  return <div className={`mb-4 text-sm px-3 py-2 rounded-lg border ${m.cls}`}>{m.text}</div>;
}

// Deep links kept stable across the redesign: ?tab=policy|facilities|photos
// predate the grouped tab, so they resolve to it with the right sub-panel
// selected rather than 404ing into a default.
function InitialTab({ onResolved }: { onResolved: (tab: TabId, sub?: SubTabId) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const requested = params.get("tab");
    if (!requested) return;
    if ((CONTENT_SUBTABS as readonly { id: string }[]).some((s) => s.id === requested)) {
      onResolved("content", requested as SubTabId);
    } else if (requested === "content" || PRIMARY_TABS.some((t) => t.id === requested)) {
      onResolved(requested as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function PropertyListingTabs({ propertyId, isChannex }: { propertyId: string; isChannex: boolean }) {
  const [tab, setTab] = useState<TabId>(isChannex ? "rateplans" : "taxes");
  const [sub, setSub] = useState<SubTabId>("policy");

  return (
    <div>
      <Suspense fallback={null}>
        <InitialTab
          onResolved={(t, s) => {
            setTab(t);
            if (s) setSub(s);
          }}
        />
        <PaymentSetupBanner />
      </Suspense>

      <div className="flex items-center gap-1 mb-4 overflow-x-auto">
        {PRIMARY_TABS.filter((t) => isChannex || !t.channexOnly).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              tab === id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}

        {isChannex && (
          <>
            <div className="w-px self-stretch bg-slate-200 mx-1 shrink-0" aria-hidden />
            {/* Deliberately quieter than its siblings, active state included:
                the dashed border and muted palette say "optional" before the
                copy inside does. */}
            <button
              onClick={() => setTab("content")}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition border border-dashed ${
                tab === "content"
                  ? "bg-slate-100 text-slate-700 border-slate-300"
                  : "text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Listing content
            </button>
          </>
        )}
      </div>

      {tab === "taxes" && <CityTaxSettingsPanel propertyId={propertyId} />}
      {isChannex && tab === "rateplans" && <RateRevenueTab propertyId={propertyId} />}
      {isChannex && tab === "reviews" && <ReviewsPanel propertyId={propertyId} />}
      {isChannex && tab === "payments" && <PaymentsSetupPanel propertyId={propertyId} />}

      {isChannex && tab === "content" && (
        <div>
          <div className="mb-4 text-sm px-3.5 py-2.5 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-500">
            These pages are <span className="font-semibold text-slate-600">optional</span> — Booking.com,
            Airbnb and your other OTAs already have these details on your live listing. Fill them in only
            if you want a copy kept in host24.
          </div>
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {CONTENT_SUBTABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSub(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  sub === id ? "bg-slate-200 text-slate-800" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
                <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded bg-white text-slate-400 border border-slate-200">
                  optional
                </span>
              </button>
            ))}
          </div>
          {sub === "policy" && <HotelPolicyPanel propertyId={propertyId} />}
          {sub === "facilities" && <FacilitiesPanel propertyId={propertyId} />}
          {sub === "photos" && <PhotosPanel propertyId={propertyId} />}
        </div>
      )}

      {!isChannex && tab !== "taxes" && (
        <div className="bg-white rounded-2xl border border-slate-100 text-center py-8 text-slate-400">
          <p className="text-sm">This property isn&apos;t on Channex.</p>
          <p className="text-xs mt-1">
            Rate plans, reviews, card payments and listing content only apply to Channex-managed listings.
          </p>
        </div>
      )}
    </div>
  );
}
