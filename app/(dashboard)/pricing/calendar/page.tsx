"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import PriceCalendarPanel, { PriceCalendarProperty } from "@/components/pricing/PriceCalendarPanel";

export default function LivePricingCalendar() {
  const [properties, setProperties] = useState<PriceCalendarProperty[]>([]);
  const [propId, setPropId] = useState("");

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((data) => {
      const list = Array.isArray(data) ? data : [];
      setProperties(list);
      if (list.length) setPropId(list[0].id);
    });
  }, []);

  const property = properties.find((p) => p.id === propId);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{property?.channelProvider === "CHANNEX" ? "Prices" : "Live Prices"}</h1>
        </div>
        <Link href="/pricing" className="text-sm text-slate-500 hover:text-slate-800">Pricing rules →</Link>
      </div>

      <div className="mb-5">
        <select
          value={propId}
          onChange={(e) => setPropId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[280px]"
        >
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {property && <PriceCalendarPanel property={property} />}
    </div>
  );
}
