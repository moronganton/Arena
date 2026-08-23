"use client";
import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Landmark, ClipboardList, Sparkles, Images, Star, CreditCard } from "lucide-react";
import CityTaxSettingsPanel from "@/components/properties/CityTaxSettingsPanel";
import {
  HotelPolicyPanel,
  FacilitiesPanel,
  PhotosPanel,
  ReviewsPanel,
  PaymentsSetupPanel,
} from "@/components/properties/ListingContentPanels";

interface PropertyLite {
  id: string;
  name: string;
  channelProvider: string;
}

// Channex-only tabs - each one talks to a Channex catalogue API, so none of
// it applies to a Smoobu-managed property. Rate & automation (city tax) is
// the one tab that works for every property regardless of channel manager,
// so it's listed separately below rather than in this array.
const CHANNEX_TABS = [
  { id: "policy", label: "Hotel Policy", icon: ClipboardList },
  { id: "facilities", label: "Facilities", icon: Sparkles },
  { id: "photos", label: "Photos", icon: Images },
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "payments", label: "Payments", icon: CreditCard },
] as const;
type ChannexTabId = (typeof CHANNEX_TABS)[number]["id"];
type TabId = "rate" | ChannexTabId;

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

export default function PropertyListingPage() {
  const params = useParams();
  const propertyId = params.id as string;

  const [property, setProperty] = useState<PropertyLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("rate");

  useEffect(() => {
    fetch(`/api/properties/${propertyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProperty(p ? { id: p.id, name: p.name, channelProvider: p.channelProvider } : null))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const isChannex = property?.channelProvider === "CHANNEX";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <Suspense fallback={null}>
        <InitialTab onResolved={setTab} />
      </Suspense>

      <Link href={`/properties/${propertyId}`} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Property
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Listing &amp; tax settings{property ? ` — ${property.name}` : ""}
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Rate &amp; automation works for any property. Hotel policy, facilities, photos, reviews, and card payments
          are synced through Channex, so they only apply to Channex-managed listings.
        </p>
      </div>

      <Suspense fallback={null}>
        <PaymentSetupBanner />
      </Suspense>

      {loading ? (
        <p className="text-sm text-slate-400">Loading&hellip;</p>
      ) : !property ? (
        <p className="text-sm text-red-600">Property not found.</p>
      ) : (
        <>
          <div className="flex gap-1 mb-4 overflow-x-auto">
            <button
              onClick={() => setTab("rate")}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                tab === "rate" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Landmark className="w-3.5 h-3.5" />
              Rate &amp; automation
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

          {!isChannex && tab !== "rate" && (
            <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center mb-4">
              <p className="text-sm text-slate-500">This property isn&apos;t on Channex.</p>
              <p className="text-xs text-slate-400 mt-1">Hotel policy, facilities, photos, reviews, and card payments only apply to Channex-managed listings.</p>
            </div>
          )}

          {tab === "rate" && <CityTaxSettingsPanel propertyId={propertyId} />}
          {isChannex && tab === "policy" && <HotelPolicyPanel propertyId={propertyId} />}
          {isChannex && tab === "facilities" && <FacilitiesPanel propertyId={propertyId} />}
          {isChannex && tab === "photos" && <PhotosPanel propertyId={propertyId} />}
          {isChannex && tab === "reviews" && <ReviewsPanel propertyId={propertyId} />}
          {isChannex && tab === "payments" && <PaymentsSetupPanel propertyId={propertyId} />}
        </>
      )}
    </div>
  );
}
