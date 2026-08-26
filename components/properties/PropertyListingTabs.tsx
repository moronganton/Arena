"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Landmark, ClipboardList, Sparkles, Images, Star, CreditCard, Layers } from "lucide-react";
import CityTaxSettingsPanel from "@/components/properties/CityTaxSettingsPanel";
import RatePlansPanel from "@/components/properties/RatePlansPanel";
import {
  HotelPolicyPanel,
  FacilitiesPanel,
  PhotosPanel,
  ReviewsPanel,
  PaymentsSetupPanel,
} from "@/components/properties/ListingContentPanels";

// Channex-only tabs - each one talks to a Channex catalogue API, so none of
// it applies to a Smoobu-managed property. "Taxes & fees" is the one tab
// that works for every property regardless of channel manager, so it's
// always shown first, ahead of this list.
const CHANNEX_TABS = [
  // First of the Channex tabs: what the listing actually sells is the thing
  // you check before anything about how it is described.
  { id: "rateplans", label: "Rate plans", icon: Layers },
  { id: "policy", label: "Hotel Policy", icon: ClipboardList },
  { id: "facilities", label: "Facilities", icon: Sparkles },
  { id: "photos", label: "Photos", icon: Images },
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "payments", label: "Payments", icon: CreditCard },
] as const;
type ChannexTabId = (typeof CHANNEX_TABS)[number]["id"];
type TabId = "taxes" | ChannexTabId;

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

function InitialTab({ onResolved }: { onResolved: (tab: TabId) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const requested = params.get("tab") as TabId | null;
    if (requested) onResolved(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Inline, directly on the property page - these used to live behind a
// separate /properties/[id]/listing route with its own back-navigation,
// which just added a click between "looking at the property" and "editing
// what makes it up." Taxes & fees works for any property; the rest are
// Channex catalogue data and only apply to Channex-managed listings.
export default function PropertyListingTabs({ propertyId, isChannex }: { propertyId: string; isChannex: boolean }) {
  const [tab, setTab] = useState<TabId>("taxes");

  return (
    <div>
      <Suspense fallback={null}>
        <InitialTab onResolved={setTab} />
        <PaymentSetupBanner />
      </Suspense>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        <button
          onClick={() => setTab("taxes")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
            tab === "taxes" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Landmark className="w-3.5 h-3.5" />
          Taxes &amp; Fees Settings
        </button>
        {isChannex &&
          CHANNEX_TABS.map(({ id, label, icon: Icon }) => (
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
      </div>

      {!isChannex && tab !== "taxes" && (
        <div className="bg-white rounded-2xl border border-slate-100 text-center py-8 text-slate-400">
          <p className="text-sm">This property isn&apos;t on Channex.</p>
          <p className="text-xs mt-1">Hotel policy, facilities, photos, reviews, and card payments only apply to Channex-managed listings.</p>
        </div>
      )}

      {tab === "taxes" && <CityTaxSettingsPanel propertyId={propertyId} />}
      {isChannex && tab === "rateplans" && <RatePlansPanel propertyId={propertyId} />}
      {isChannex && tab === "policy" && <HotelPolicyPanel propertyId={propertyId} />}
      {isChannex && tab === "facilities" && <FacilitiesPanel propertyId={propertyId} />}
      {isChannex && tab === "photos" && <PhotosPanel propertyId={propertyId} />}
      {isChannex && tab === "reviews" && <ReviewsPanel propertyId={propertyId} />}
      {isChannex && tab === "payments" && <PaymentsSetupPanel propertyId={propertyId} />}
    </div>
  );
}
