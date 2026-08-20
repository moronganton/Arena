"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MessageSquare, MessageSquareText, BookOpen, CalendarDays, MoreHorizontal,
  Home, Sparkles, Wallet, RefreshCw, Key, Bot, LogOut, X, Lightbulb, ShieldCheck,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

interface Activity {
  messages: number;
  bookings: number;
  moreDot: boolean;
}

const MORE_LINKS = [
  { href: "/templates", label: "Templates", icon: MessageSquareText },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/cleaning", label: "Cleaning", icon: Sparkles },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/settings/channels", label: "Channels", icon: RefreshCw },
  { href: "/settings/locks", label: "Smart Locks", icon: Key },
  { href: "/settings/ai", label: "AI Assistant", icon: Bot },
  { href: "/settings/account", label: "Account security", icon: ShieldCheck },
  { href: "/ideas", label: "Submit Ideas", icon: Lightbulb },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1 left-1/2 ml-1.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function BottomTabBar() {
  const pathname = usePathname();
  const [activity, setActivity] = useState<Activity>({ messages: 0, bookings: 0, moreDot: false });
  const [moreOpen, setMoreOpen] = useState(false);

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (res.ok) setActivity(await res.json());
    } catch {
      // badges are best-effort — never break navigation over them
    }
  }, []);

  // Refresh badges on navigation and every minute
  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 60000);
    return () => clearInterval(interval);
  }, [loadActivity, pathname]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  const moreActive = MORE_LINKS.some((l) => isActive(l.href));

  const tabClass = (active: boolean) =>
    cn(
      "relative flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
      active ? "text-indigo-600" : "text-slate-400"
    );

  return (
    <>
      {/* More sheet */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl p-5 pb-8">
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-slate-900">More</p>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {MORE_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 py-3 rounded-2xl text-center transition-colors",
                    isActive(href) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium leading-tight">{label}</span>
                </Link>
              ))}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </>
      )}

      {/* Tab bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 grid grid-cols-5"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link href="/dashboard" className={tabClass(isActive("/dashboard"))}>
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-semibold">Home</span>
        </Link>
        <Link href="/messages" className={tabClass(isActive("/messages"))}>
          <span className="relative">
            <MessageSquare className="w-5 h-5" />
            <Badge count={activity.messages} />
          </span>
          <span className="text-[10px] font-semibold">Messages</span>
        </Link>
        <Link href="/reservations" className={tabClass(isActive("/reservations"))}>
          <span className="relative">
            <BookOpen className="w-5 h-5" />
            <Badge count={activity.bookings} />
          </span>
          <span className="text-[10px] font-semibold">Bookings</span>
        </Link>
        <Link href="/calendar" className={tabClass(isActive("/calendar"))}>
          <CalendarDays className="w-5 h-5" />
          <span className="text-[10px] font-semibold">Calendar</span>
        </Link>
        <button onClick={() => setMoreOpen(true)} className={tabClass(moreActive || moreOpen)}>
          <span className="relative">
            <MoreHorizontal className="w-5 h-5" />
            {activity.moreDot && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-rose-500 border-2 border-white" />
            )}
          </span>
          <span className="text-[10px] font-semibold">More</span>
        </button>
      </nav>
    </>
  );
}
