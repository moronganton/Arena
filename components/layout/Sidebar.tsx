"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  CalendarDays,
  MessageSquare,
  MessageSquareText,
  Home,
  BookOpen,
  Key,
  Bot,
  LogOut,
  RefreshCw,
  Sparkles,
  Wallet,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reservations", label: "Reservations", icon: BookOpen },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/templates", label: "Templates", icon: MessageSquareText },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/cleaning", label: "Cleaning", icon: Sparkles },
  { href: "/finance", label: "Finance", icon: Wallet },
];

const settingsItems = [
  { href: "/settings/smoobu", label: "Smoobu", icon: RefreshCw },
  { href: "/settings/locks", label: "Smart Locks", icon: Key },
  { href: "/settings/ai", label: "AI Assistant", icon: Bot },
  { href: "/settings/account", label: "Account security", icon: ShieldCheck },
  { href: "/ideas", label: "Submit Ideas", icon: Lightbulb },
];

export function Sidebar() {
  const pathname = usePathname();

  // h-screen + sticky, not min-h-screen: as a flex child the sidebar otherwise
  // stretched to the full document height, which pushed the Sign Out button at
  // its foot to the bottom of the whole page. On a short page (Calendar) that
  // still landed on screen; on a long one (Dashboard) it sat far below the fold
  // and looked like it was missing. Pinned to the viewport it is reachable from
  // every tab.
  return (
    <aside className="hidden lg:flex w-64 h-screen sticky top-0 shrink-0 bg-sidebar flex-col">
      <div className="p-6 border-b border-sidebar-border flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="text-sidebar-foreground font-bold text-lg">StayHQ</span>
        </Link>
        <NotificationBell />
      </div>

      {/* Scrolls independently so the pinned Sign Out footer stays visible even
          if the nav list grows past the viewport. */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
                ? "bg-sidebar-primary text-white"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {label}
          </Link>
        ))}

        <div className="pt-4 pb-1">
          <p className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2">
            Settings
          </p>
          {settingsItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                pathname === href
                  ? "bg-sidebar-primary text-white"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
