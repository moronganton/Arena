"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Pulls the latest Smoobu messages the moment the Messages tab opens, then
// refreshes the list if anything new arrived. The background cron keeps things
// current while away; this makes it fresh the instant the host looks.
export function MessagesAutoSync() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/messages/sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data.newMessages > 0) router.refresh();
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [router]);

  if (!syncing) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking for new messages…
    </span>
  );
}
