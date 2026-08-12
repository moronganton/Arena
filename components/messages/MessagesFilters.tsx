"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SOURCE_LABELS } from "@/lib/utils";
import { FilterMenu, FilterSection, FilterPills, FilterList, FilterToggle } from "@/components/ui/FilterMenu";

interface Property {
  id: string;
  name: string;
}

interface Props {
  properties: Property[];
  initial: { propertyId: string; source: string; unread: boolean; needsReply: boolean };
}

const SOURCES = ["BOOKING", "AIRBNB", "VRBO", "EXPEDIA", "DIRECT"];

export function MessagesFilters({ properties, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [source, setSource] = useState(initial.source);
  const [unread, setUnread] = useState(initial.unread);
  const [needsReply, setNeedsReply] = useState(initial.needsReply);

  const activeCount = [propertyId, source].filter(Boolean).length + (unread ? 1 : 0) + (needsReply ? 1 : 0);

  function navigate(next: { propertyId: string; source: string; unread: boolean; needsReply: boolean }) {
    const params = new URLSearchParams();
    if (next.propertyId) params.set("propertyId", next.propertyId);
    if (next.source) params.set("source", next.source);
    if (next.unread) params.set("unread", "1");
    if (next.needsReply) params.set("needsReply", "1");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.name }));
  const sourceOptions = SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));

  return (
    <FilterMenu
      activeCount={activeCount}
      onClear={() => {
        setPropertyId(""); setSource(""); setUnread(false); setNeedsReply(false);
        navigate({ propertyId: "", source: "", unread: false, needsReply: false });
      }}
      onApply={() => navigate({ propertyId, source, unread, needsReply })}
    >
      <FilterSection label="Channel">
        <FilterPills options={sourceOptions} value={source} onChange={setSource} />
      </FilterSection>
      <FilterSection label="Property">
        <FilterList
          options={propertyOptions}
          selected={propertyId ? [propertyId] : []}
          onToggle={(v) => setPropertyId(v)}
          onClearAll={() => setPropertyId("")}
          allLabel="All Properties"
        />
      </FilterSection>
      <div className="space-y-2.5">
        <FilterToggle label="Unread only" on={unread} onChange={() => setUnread((v) => !v)} />
        <FilterToggle label="Needs my reply" on={needsReply} onChange={() => setNeedsReply((v) => !v)} />
      </div>
    </FilterMenu>
  );
}
