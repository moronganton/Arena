"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { SOURCE_LABELS } from "@/lib/utils";
import { FilterMenu, FilterSection, FilterPills, FilterList } from "@/components/ui/FilterMenu";

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

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ q, propertyId, status, source, sort });
  }

  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.name }));
  const statusOptions = STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
  const sourceOptions = SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
  const sortOptions = SORTS.map(([value, label]) => ({ value, label }));

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

        <FilterMenu
          activeCount={activeCount}
          onClear={() => {
            setPropertyId(""); setStatus(""); setSource(""); setSort("newest");
            navigate({ q, propertyId: "", status: "", source: "", sort: "newest" });
          }}
          onApply={() => navigate({ q, propertyId, status, source, sort })}
        >
          <FilterSection label="Property">
            <FilterList
              options={propertyOptions}
              selected={propertyId ? [propertyId] : []}
              onToggle={(v) => setPropertyId(v)}
              onClearAll={() => setPropertyId("")}
              allLabel="All Properties"
            />
          </FilterSection>
          <FilterSection label="Status">
            <FilterPills options={statusOptions} value={status} onChange={setStatus} />
          </FilterSection>
          <FilterSection label="Channel">
            <FilterPills options={sourceOptions} value={source} onChange={setSource} />
          </FilterSection>
          <FilterSection label="Sort by">
            <FilterPills options={sortOptions} value={sort} onChange={(v) => setSort(v || "newest")} allLabel={null} />
          </FilterSection>
        </FilterMenu>
      </div>
    </div>
  );
}
