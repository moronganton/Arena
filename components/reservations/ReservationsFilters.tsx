"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Filter, Check } from "lucide-react";
import { SOURCE_LABELS } from "@/lib/utils";

interface Property {
  id: string;
  name: string;
}

interface Props {
  properties: Property[];
  initial: { q: string; propertyId: string; status: string; source: string; sort: string };
}

const STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"];
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending", CONFIRMED: "Confirmed", CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out", CANCELLED: "Cancelled",
};
const SOURCES = ["BOOKING", "AIRBNB", "VRBO", "EXPEDIA", "DIRECT"];
const SORTS: Array<[string, string]> = [
  ["newest", "Newest bookings first"],
  ["oldest", "Oldest bookings first"],
  ["checkin", "By check-in date"],
];

export function ReservationsFilters({ properties, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial.q);
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [status, setStatus] = useState(initial.status);
  const [source, setSource] = useState(initial.source);
  const [sort, setSort] = useState(initial.sort || "newest");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Sort is an ordering preference, not a narrowing filter - it doesn't count toward the badge.
  const activeCount = [propertyId, status, source].filter(Boolean).length;

  function navigate(next: { propertyId: string; status: string; source: string; sort: string; q: string }) {
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.propertyId) params.set("propertyId", next.propertyId);
    if (next.status) params.set("status", next.status);
    if (next.source) params.set("source", next.source);
    if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply() {
    navigate({ q, propertyId, status, source, sort });
    setOpen(false);
  }

  function clearAll() {
    setPropertyId(""); setStatus(""); setSource(""); setSort("newest");
    navigate({ q, propertyId: "", status: "", source: "", sort: "newest" });
    setOpen(false);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ q, propertyId, status, source, sort });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-6">
      <div className="flex items-center gap-2">
        <form onSubmit={submitSearch} className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search guest or code..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </form>

        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Filters"
            className={`relative w-10 h-10 rounded-xl border flex items-center justify-center transition ${
              open || activeCount > 0
                ? "border-indigo-300 bg-indigo-50 text-indigo-600"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] px-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {activeCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-20">
              <div className="mb-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Property</p>
                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setPropertyId("")}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left border-b border-slate-100 last:border-0 ${
                      propertyId === "" ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    All Properties
                    {propertyId === "" && <Check className="w-3.5 h-3.5" />}
                  </button>
                  {properties.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPropertyId(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left border-b border-slate-100 last:border-0 truncate ${
                        propertyId === p.id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {propertyId === p.id && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setStatus("")}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                      status === "" ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
                    }`}
                  >
                    All
                  </button>
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                        status === s ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Channel</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSource("")}
                    className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                      source === "" ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
                    }`}
                  >
                    All
                  </button>
                  {SOURCES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSource(s)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                        source === s ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
                      }`}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  {SORTS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSort(value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                        sort === value ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <button type="button" onClick={clearAll} className="text-xs font-medium text-slate-400 hover:text-slate-600">
                  Clear all
                </button>
                <button type="button" onClick={apply} className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition">
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
