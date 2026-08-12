"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FilterMenu, FilterSection, FilterPills } from "@/components/ui/FilterMenu";

interface Props {
  cities: string[];
  initial: { city: string; status: string };
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function PropertiesFilters({ cities, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [city, setCity] = useState(initial.city);
  const [status, setStatus] = useState(initial.status);

  const activeCount = [city, status].filter(Boolean).length;
  const cityOptions = cities.map((c) => ({ value: c, label: c }));

  function navigate(next: { city: string; status: string }) {
    const params = new URLSearchParams();
    if (next.city) params.set("city", next.city);
    if (next.status) params.set("status", next.status);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <FilterMenu
      activeCount={activeCount}
      onClear={() => { setCity(""); setStatus(""); navigate({ city: "", status: "" }); }}
      onApply={() => navigate({ city, status })}
    >
      <FilterSection label="City">
        <FilterPills options={cityOptions} value={city} onChange={setCity} />
      </FilterSection>
      <FilterSection label="Status">
        <FilterPills options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </FilterSection>
    </FilterMenu>
  );
}
