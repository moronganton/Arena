"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Check, MessageSquare, AlertTriangle, PackageX, LogOut, Info } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

const ICONS: Record<string, typeof Bell> = {
  guest_reply: MessageSquare,
  ai_paused: AlertTriangle,
  delivery_failed: PackageX,
  checkout: LogOut,
  info: Info,
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Convert a base64url VAPID key into the Uint8Array the Push API expects
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [pushState, setPushState] = useState<"unsupported" | "default" | "granted" | "denied" | "busy">("default");
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const data = await r.json();
      setItems(data.items || []);
      setUnread(data.unreadCount || 0);
    } catch {
      /* offline / transient — keep last state */
    }
  }, []);

  // Register the service worker + poll for new notifications
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (!("Notification" in window) || !("PushManager" in window)) {
      setPushState("unsupported");
    } else {
      setPushState(Notification.permission as "default" | "granted" | "denied");
    }
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function openItem(n: Notification) {
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function enablePush() {
    setPushState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission as "denied" | "default");
        return;
      }
      const vapid = await fetch("/api/push/vapid").then((r) => r.json());
      if (!vapid.key) {
        // Push isn't configured on the server yet — permission is granted, but
        // we can't subscribe. Leave it; in-app notifications still work.
        setPushState("granted");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.key),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      setPushState("granted");
    } catch (err) {
      console.error("Enable push failed:", err);
      setPushState(Notification.permission as "default" | "granted" | "denied");
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      >
        {unread > 0 ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-semibold text-slate-900 text-sm">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          {/* Push opt-in banner */}
          {pushState !== "granted" && pushState !== "unsupported" && (
            <button
              onClick={enablePush}
              disabled={pushState === "busy" || pushState === "denied"}
              className="w-full flex items-start gap-2.5 px-4 py-3 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-70 text-left transition-colors border-b border-indigo-100"
            >
              <BellRing className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
              <span className="text-xs text-indigo-900 leading-snug">
                {pushState === "denied"
                  ? "Push is blocked in your browser settings. Allow notifications for this site to get phone alerts."
                  : pushState === "busy"
                  ? "Enabling…"
                  : "Get alerts on your phone even when StayHQ is closed. Tap to enable push notifications."}
              </span>
            </button>
          )}

          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">You&apos;re all caught up.</div>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.type] || Info;
                return (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      n.isRead ? "" : "bg-indigo-50/40"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 ${
                        n.type === "ai_paused" || n.type === "delivery_failed"
                          ? "bg-rose-100 text-rose-600"
                          : "bg-indigo-100 text-indigo-600"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-sm truncate ${n.isRead ? "text-slate-700" : "text-slate-900 font-semibold"}`}>
                          {n.title}
                        </span>
                        <span className="text-[11px] text-slate-400 flex-shrink-0">{timeAgo(n.createdAt)}</span>
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</span>
                    </span>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
