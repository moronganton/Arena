"use client";
import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

export interface AttentionItem {
  messageId: string;
  reservationId: string;
  property: string;
  question: string;
  receivedAt: Date;
}

function fmt(d: Date): { date: string; time: string } {
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

export function NeedsReplyList({ initial }: { initial: AttentionItem[] }) {
  const [items, setItems] = useState<AttentionItem[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toastItem, setToastItem] = useState<AttentionItem | null>(null);

  async function dismiss(item: AttentionItem, e: React.MouseEvent) {
    e.preventDefault(); // this button sits inside a Link — don't navigate
    e.stopPropagation();
    setBusyId(item.messageId);
    const res = await fetch("/api/messages/needs-reply", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: item.messageId, needsHostReply: false }),
    });
    setBusyId(null);
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.messageId !== item.messageId));
      setToastItem(item);
      setTimeout(() => setToastItem((cur) => (cur?.messageId === item.messageId ? null : cur)), 6000);
    }
  }

  async function undo(item: AttentionItem) {
    setToastItem(null);
    setItems((prev) => [item, ...prev]);
    await fetch("/api/messages/needs-reply", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: item.messageId, needsHostReply: true }),
    });
  }

  return (
    <div>
      {items.length === 0 && !toastItem && (
        <p className="px-4 py-8 text-center text-sm text-slate-400">No guest questions waiting. 🎉</p>
      )}
      {items.map((a) => {
        const t = fmt(a.receivedAt);
        return (
          <Link
            key={a.messageId}
            href={`/reservations/${a.reservationId}`}
            className="flex items-start gap-2 px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"
          >
            <div className="w-11 shrink-0 mt-0.5">
              <span className="block text-[9px] text-indigo-600 font-bold leading-tight truncate" title={a.property}>{a.property}</span>
              <span className="block text-[8px] text-slate-400 leading-tight mt-0.5">{t.date}</span>
              <span className="block text-[8px] text-slate-400 leading-tight">{t.time}</span>
            </div>
            <span className="text-[10px] text-slate-800 flex-1 min-w-0 truncate mt-0.5">{a.question}</span>
            <button
              onClick={(e) => dismiss(a, e)}
              disabled={busyId === a.messageId}
              title="No reply needed"
              className="w-5 h-5 rounded-full border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-300 hover:text-emerald-600 flex items-center justify-center shrink-0 mt-0.5 transition disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
            </button>
          </Link>
        );
      })}
      {toastItem && (
        <div className="flex items-center justify-between gap-2 mx-3 my-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs font-medium text-emerald-700">
          <span>Marked as no reply needed</span>
          <button onClick={() => undo(toastItem)} className="underline decoration-emerald-300 underline-offset-2 font-semibold flex-shrink-0">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
