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

interface Values { q: string; propertyId: string; status: string; source: string; sort: string }

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

function navigateTo(router: ReturnType<typeof useRouter>, pathname: string, next: Values) {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.propertyId) params.set("propertyId", next.propertyId);
  if (next.status) params.set("status", next.status);
  if (next.source) params.set("source", next.source);
  if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
  const qs = params.toString();
  router.push(qs ? `${pathname}?${qs}` : pathname);
}

// The persistent search input - its own row, since it's a always-visible
// text field rather than an icon-triggered control.
export function ReservationsSearchBar({ initial }: { initial: Values }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial.q);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    navigateTo(router, pathname, { ...initial, q });
  }

  return (
    <form onSubmit={submit} className="relative">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search guest or code..."
        className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </form>
  );
}

// The funnel icon - lives in the header's action row alongside every other
// tab's icon-buttons (Bulk Import, New, etc.), not off in a separate card.
export function ReservationsFilterMenu({ properties, initial }: { properties: Property[]; initial: Values }) {
  const router = useRouter();
  const pathname = usePathname();
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [status, setStatus] = useState(initial.status);
  const [source, setSource] = useState(initial.source);
  const [sort, setSort] = useState(initial.sort || "newest");

  // Sort is an ordering preference, not a narrowing filter - it doesn't count toward the badge.
  const activeCount = [propertyId, status, source].filter(Boolean).length;

  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.name }));
  const statusOptions = STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
  const sourceOptions = SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
  const sortOptions = SORTS.map(([value, label]) => ({ value, label }));

  return (
    <FilterMenu
      activeCount={activeCount}
      onClear={() => {
        setPropertyId(""); setStatus(""); setSource(""); setSort("newest");
        navigateTo(router, pathname, { q: initial.q, propertyId: "", status: "", source: "", sort: "newest" });
      }}
      onApply={() => navigateTo(router, pathname, { q: initial.q, propertyId, status, source, sort })}
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
  );
}
