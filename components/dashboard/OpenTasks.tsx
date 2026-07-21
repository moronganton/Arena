"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";

export interface Task {
  kind: "note" | "damage";
  id: string;
  text: string;
  property: string;
  meta: string; // e.g. "from chat" / "from cleaning report"
  href?: string;
}

const TAG: Record<string, { label: string; cls: string }> = {
  note: { label: "Note", cls: "bg-indigo-50 text-indigo-600" },
  damage: { label: "Damage", cls: "bg-rose-50 text-rose-600" },
};

export function OpenTasks({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function markDone(t: Task) {
    setBusy(t.id);
    const res = await fetch("/api/dashboard/task-done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: t.kind, id: t.id }),
    });
    setBusy(null);
    if (res.ok) setTasks((prev) => prev.filter((x) => !(x.id === t.id && x.kind === t.kind)));
  }

  if (tasks.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
        <CheckCircle2 className="w-8 h-8 text-emerald-300" />
        Nothing open — you&apos;re all caught up.
      </div>
    );
  }

  return (
    <div>
      {tasks.map((t) => {
        const tag = TAG[t.kind];
        const textBlock = (
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-slate-800">
              <span className={`text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mr-1.5 ${tag.cls}`}>{tag.label}</span>
              {t.text}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{t.property} · {t.meta}</div>
          </div>
        );
        return (
          <div key={`${t.kind}-${t.id}`} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
            <button
              onClick={() => markDone(t)}
              disabled={busy === t.id}
              className="w-[18px] h-[18px] rounded-md border-[1.7px] border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5 transition disabled:opacity-50"
              aria-label="Mark done"
              title="Mark done"
            >
              {busy === t.id && <Check className="w-3 h-3 text-emerald-500" />}
            </button>
            {t.href ? <Link href={t.href} className="min-w-0 flex-1">{textBlock}</Link> : textBlock}
          </div>
        );
      })}
    </div>
  );
}
