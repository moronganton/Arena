"use client";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { NotificationBell } from "@/components/notifications/NotificationBell";

// Mobile top bar: branding + notification bell. Navigation lives in the bottom
// tab bar (components/layout/BottomTabBar.tsx) — no more hamburger drawer.
export function MobileNav() {
  return (
    <header
      className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar flex items-end justify-between border-b border-sidebar-border"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Link href="/dashboard" className="flex items-center gap-2 h-14 px-4">
        <div className="w-7 h-7 bg-sidebar-primary rounded-lg flex items-center justify-center">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <span className="text-sidebar-foreground font-bold text-base">StayHQ</span>
      </Link>
      <div className="flex items-center h-14 px-2">
        <NotificationBell />
      </div>
    </header>
  );
}
