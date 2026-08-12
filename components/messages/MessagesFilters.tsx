"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Filter, Check } from "lucide-react";
import { SOURCE_LABELS } from "@/lib/utils";

interface Property {
  id: string;
  name: string;
}

interface Props {
  properties: Property[];
  initial: { propertyId: string; source: string; unread: boolean; needsReply: boolean };
}

const SOURCES = ["BOOKING", "AIRBNB", "VRBO", "EXPEDIA", "DIRECT"];

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${on ? "bg-indigo-600" : "bg-slate-200"}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function MessagesFilters({ properties, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [source, setSource] = useState(initial.source);
  const [unread, setUnread] = useState(initial.unread);
  const [needsReply, setNeedsReply] = useState(initial.needsReply);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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

  function apply() {
    navigate({ propertyId, source, unread, needsReply });
    setOpen(false);
  }

  function clearAll() {
    setPropertyId(""); setSource(""); setUnread(false); setNeedsReply(false);
    navigate({ propertyId: "", source: "", unread: false, needsReply: false });
    setOpen(false);
  }

  return (
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
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-20">
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

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700">Unread only</span>
              <Switch on={unread} onClick={() => setUnread((v) => !v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700">Needs my reply</span>
              <Switch on={needsReply} onClick={() => setNeedsReply((v) => !v)} />
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
  );
}
