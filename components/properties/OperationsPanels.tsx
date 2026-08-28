"use client";
import { useState } from "react";
import Link from "next/link";
import { BookOpen, Key, Wifi, MessageSquareText, SlidersHorizontal } from "lucide-react";
import ChannexMappingFrame from "@/components/channels/ChannexMappingFrame";

// The operations tabs: what used to be the property page's right sidebar,
// promoted into the ribbon. Same data, same links - but as first-class tabs
// instead of cards squeezing the main column to two thirds of the screen.
//
// Everything here is serialized server-side (dates as ISO strings) because
// these render inside a client component tree.

export interface ChannelSummary {
  manager: string;
  warning: string | null;
  channexConnected: boolean;
  lastPushAt: string | null;
  pendingUpdates: number;
  failedUpdates: number;
  smoobuLastSyncAt: string | null;
  icalFeeds: { channel: string; lastSyncAt: string | null }[];
}

export interface LockSummary {
  id: string;
  name: string;
  isActive: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
  scoped: boolean; // true = this property only, false = applies to all properties
}

const CHANNEL_INFO: Record<string, { color: string; label: string }> = {
  BOOKING: { color: "bg-blue-100 text-blue-700", label: "Booking.com" },
  AIRBNB: { color: "bg-rose-100 text-rose-700", label: "Airbnb" },
  VRBO: { color: "bg-green-100 text-green-700", label: "VRBO" },
  EXPEDIA: { color: "bg-yellow-100 text-yellow-700", label: "Expedia" },
};

function fmtDate(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString() : null;
}

export function ChannelsPanel({
  propertyId,
  propertyName,
  channels,
}: {
  propertyId: string;
  propertyName: string;
  channels: ChannelSummary | null;
}) {
  const [mapping, setMapping] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
        <Wifi className="w-4 h-4 text-slate-500" />
        Channels
      </h3>

      {channels?.manager === "CHANNEX" && channels.channexConnected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal-100 text-teal-800">Channex</span>
              <span className="text-xs text-green-600">Connected</span>
            </div>
            {/* Opens the embedded mapping UI right here rather than sending the
                operator to the settings page first. */}
            <button
              onClick={() => setMapping(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 px-2.5 py-1.5 rounded-lg transition"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Manage channels
            </button>
          </div>
          <dl className="text-xs text-slate-500 space-y-1">
            <div className="flex justify-between gap-3">
              <dt>Last availability push</dt>
              <dd className="text-slate-700">{fmtDate(channels.lastPushAt) ?? "Not pushed yet"}</dd>
            </div>
            {channels.pendingUpdates > 0 && (
              <div className="flex justify-between gap-3">
                <dt>Queued updates</dt>
                <dd className="text-slate-700">{channels.pendingUpdates}</dd>
              </div>
            )}
            {channels.failedUpdates > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-red-600">Failed updates</dt>
                <dd className="text-red-600">{channels.failedUpdates}</dd>
              </div>
            )}
          </dl>
        </div>
      ) : channels?.manager === "SMOOBU" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-800">Smoobu</span>
            <span className="text-xs text-green-600">Connected</span>
          </div>
          <p className="text-xs text-slate-500">
            {fmtDate(channels.smoobuLastSyncAt)
              ? `Last synced ${fmtDate(channels.smoobuLastSyncAt)}`
              : "Not synced yet"}
          </p>
        </div>
      ) : (
        <div>
          <p className="text-slate-400 text-sm mb-3">No channel manager connected</p>
          <Link href="/settings/channels" className="text-sm text-indigo-600 hover:underline">
            Set one up &rarr;
          </Link>
        </div>
      )}

      {channels?.warning && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {channels.warning}
        </p>
      )}

      {/* iCal feeds are per-OTA calendar subscriptions, a separate thing from
          the manager that owns the listing - listed apart, not mixed in. */}
      {channels && channels.icalFeeds.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-2">Calendar feeds</p>
          <div className="space-y-1.5">
            {channels.icalFeeds.map((feed) => {
              const info = CHANNEL_INFO[feed.channel];
              return (
                <div key={feed.channel} className="flex items-center justify-between">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${info?.color || "bg-slate-100 text-slate-600"}`}>
                    {info?.label || feed.channel}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDate(feed.lastSyncAt) ? `Synced ${fmtDate(feed.lastSyncAt)}` : "Not synced"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Link href="/settings/channels" className="text-sm text-indigo-600 hover:underline mt-4 block">
        All channel settings &rarr;
      </Link>

      {mapping && (
        <ChannexMappingFrame propertyId={propertyId} propertyName={propertyName} onClose={() => setMapping(false)} />
      )}
    </div>
  );
}

export function LocksPanel({ locks }: { locks: LockSummary[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
        <Key className="w-4 h-4 text-slate-500" />
        Smart locks
      </h3>
      {locks.length === 0 ? (
        <div>
          <p className="text-slate-400 text-sm mb-3">No locks configured</p>
          <Link href="/settings/locks" className="text-sm text-indigo-600 hover:underline">
            Add a lock &rarr;
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {locks.map((lock) => (
              <div key={lock.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{lock.name}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    lock.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {lock.isActive ? "Active" : "Off"}
                </span>
              </div>
            ))}
          </div>
          <Link href="/settings/locks" className="text-sm text-indigo-600 hover:underline mt-4 block">
            Manage locks &rarr;
          </Link>
        </>
      )}
    </div>
  );
}

export function KnowledgePanel({ propertyId }: { propertyId: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
        <BookOpen className="w-4 h-4 text-slate-500" />
        Knowledge base
      </h3>
      <p className="text-sm text-slate-500 mb-3">
        WiFi, parking, house rules, local tips — the AI assistant answers guests from these facts.
      </p>
      <Link href={`/properties/${propertyId}/knowledge`} className="text-sm text-indigo-600 hover:underline">
        Manage knowledge &rarr;
      </Link>
    </div>
  );
}

const TRIGGER_LABELS: Record<string, string> = {
  NEW_RESERVATION: "On new reservation",
  BEFORE_CHECKIN: "Before check-in",
  CHECKIN_DAY: "Check-in day",
  DURING_STAY: "During stay",
  BEFORE_CHECKOUT: "Before checkout",
  CHECKOUT_DAY: "Checkout day",
  AFTER_CHECKOUT: "After checkout",
  MANUAL: "Sent manually",
};

export function TemplatesPanel({ templates }: { templates: TemplateSummary[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
        <MessageSquareText className="w-4 h-4 text-slate-500" />
        Message templates
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        The automated messages guests of this property receive — templates scoped to this property, plus
        the ones that apply everywhere.
      </p>
      {templates.length === 0 ? (
        <p className="text-slate-400 text-sm mb-3">No templates yet</p>
      ) : (
        <div className="space-y-2 mb-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{t.name}</div>
                <div className="text-xs text-slate-500">{TRIGGER_LABELS[t.trigger] ?? t.trigger}</div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  t.scoped ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {t.scoped ? "This property" : "All properties"}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  t.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {t.active ? "Active" : "Off"}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link href="/templates" className="text-sm text-indigo-600 hover:underline">
        Edit templates &rarr;
      </Link>
    </div>
  );
}
