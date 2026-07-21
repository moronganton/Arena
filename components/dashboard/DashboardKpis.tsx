"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, TrendingUp, PlaneLanding, Bot, Brush, Eye, EyeOff } from "lucide-react";

interface Props {
  properties: number;
  revenue: string; // pre-formatted
  checkInsToday: number;
  aiRepliesToday: number;
  cleaningDone: number;
  cleaningTotal: number;
}

function useHidden(key: string) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(localStorage.getItem(key) === "1"); }, [key]);
  const toggle = () => setHidden((h) => { const n = !h; localStorage.setItem(key, n ? "1" : "0"); return n; });
  return [hidden, toggle] as const;
}

function Tile({
  icon: Icon, label, value, href, hidden, onToggle,
}: {
  icon: typeof Building2; label: string; value: React.ReactNode; href?: string;
  hidden?: boolean; onToggle?: () => void;
}) {
  const inner = (
    <div className="bg-white rounded-xl border border-slate-100 p-2.5 flex items-center gap-2.5 h-full hover:border-indigo-200 transition-colors">
      <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex flex-col min-w-0 leading-tight">
        <span className={`text-[17px] font-extrabold tracking-tight text-slate-900 tabular-nums ${hidden ? "blur-[6px] select-none" : ""}`}>{value}</span>
        <span className="text-[10.5px] text-slate-400 font-semibold truncate">{label}</span>
      </div>
      {onToggle && (
        <button
          onClick={(e) => { e.preventDefault(); onToggle(); }}
          className="ml-auto shrink-0 text-slate-300 hover:text-slate-500 p-1"
          aria-label={hidden ? "Show value" : "Hide value"}
        >
          {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function DashboardKpis({ properties, revenue, checkInsToday, aiRepliesToday, cleaningDone, cleaningTotal }: Props) {
  const [propHidden, togglePropHidden] = useHidden("dash.hide.properties");
  const [revHidden, toggleRevHidden] = useHidden("dash.hide.revenue");

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
      <Tile icon={Building2} label="Properties" value={properties} hidden={propHidden} onToggle={togglePropHidden} />
      <Tile icon={TrendingUp} label="Revenue this month" value={revenue} hidden={revHidden} onToggle={toggleRevHidden} />
      <Tile icon={PlaneLanding} label="Check-ins today" value={checkInsToday} href="/calendar" />
      <Tile icon={Bot} label="AI replies today" value={aiRepliesToday} href="/messages" />
      <Tile icon={Brush} label="Cleaning done today" value={`${cleaningDone}/${cleaningTotal}`} href="/cleaning" />
    </div>
  );
}
