"use client";
import { useState, useRef, useEffect, ReactNode } from "react";
import { Filter, Check } from "lucide-react";

// Shared shell for the funnel-icon-in-the-corner filter pattern: a button
// with an active-filter-count badge that opens a panel positioned to stay
// on-screen. Callers compose FilterSection/FilterPills/FilterList/FilterToggle
// as children and own their own field state + Clear/Apply behavior.

interface FilterMenuProps {
  activeCount: number;
  onClear: () => void;
  onApply: () => void;
  children: ReactNode;
}

export function FilterMenu({ activeCount, onClear, onApply, children }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-20">
          {children}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => { onClear(); setOpen(false); }}
              className="text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => { onApply(); setOpen(false); }}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3.5 last:mb-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

interface Option { value: string; label: string }

// Single-select chip row, e.g. Status / Channel / Sort.
export function FilterPills({
  options, value, onChange, allLabel = "All",
}: { options: Option[]; value: string; onChange: (v: string) => void; allLabel?: string | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {allLabel !== null && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
            value === "" ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
          }`}
        >
          {allLabel}
        </button>
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
            value === o.value ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-indigo-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Scrollable list with checkmarks. Works for both single-select (caller's
// onToggle replaces the selection) and multi-select (caller's onToggle
// adds/removes from the array) - this component just renders selected state
// and reports taps; the caller decides what "selecting one" means.
export function FilterList({
  options, selected, onToggle, onClearAll, allLabel = "All",
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  onClearAll: () => void;
  allLabel?: string;
}) {
  const allSelected = selected.length === 0;
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
      <button
        type="button"
        onClick={onClearAll}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left border-b border-slate-100 last:border-0 ${
          allSelected ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        {allLabel}
        {allSelected && <Check className="w-3.5 h-3.5" />}
      </button>
      {options.map((o) => {
        const isSelected = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left border-b border-slate-100 last:border-0 truncate ${
              isSelected ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="truncate">{o.label}</span>
            {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

export function FilterToggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-700">{label}</span>
      <button
        type="button"
        onClick={onChange}
        aria-pressed={on}
        className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${on ? "bg-indigo-600" : "bg-slate-200"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
