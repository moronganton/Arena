"use client";
import { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";

// Full-screen overlay hosting Channex's own channel/mapping UI inside StayHQ.
//
// The token behind the URL is single-use and short-lived, so it is minted on
// open (not on page load) and dropped on close - reopening mints a fresh one.
// That also means the iframe src must never be rebuilt mid-session from the
// same token, hence url lives in state and is only set once per open.
export default function ChannexMappingFrame({
  propertyId,
  propertyName,
  onClose,
}: {
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/channex/iframe-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, page: "/channels" }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (!cancelled) setUrl(d.url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open channel mapping");
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-stretch md:items-center md:justify-center md:p-6">
      <div className="bg-white w-full md:max-w-6xl md:rounded-2xl flex flex-col overflow-hidden md:h-[90vh]">
        <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900 truncate">Channels &mdash; {propertyName}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Connect an OTA, then map its rooms and rates to this property</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 relative">
          {error ? (
            <div className="p-6">
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            </div>
          ) : !url ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-slate-400">Opening channel manager&hellip;</p>
            </div>
          ) : (
            <iframe
              src={url}
              title={`Channel mapping for ${propertyName}`}
              className="w-full h-full border-0"
            />
          )}
        </div>

        {/* Booking.com is the one place the host has to leave StayHQ, and it
            cannot be embedded: the property itself must authorise the
            connectivity provider in Booking.com's extranet, behind their own
            2FA. Saying so here is better than letting a host hunt for why
            Booking.com will not map. */}
        <div className="px-4 md:px-5 py-2.5 border-t border-slate-100 bg-slate-50 shrink-0">
          <p className="text-xs text-slate-500">
            Connecting Booking.com for the first time? The property owner must first authorise the
            connection in their{" "}
            <a
              href="https://account.booking.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline inline-flex items-center gap-0.5"
            >
              Booking.com extranet <ExternalLink className="w-3 h-3" />
            </a>{" "}
            under Account &rarr; Connectivity Provider. Booking.com requires their own two-factor
            login, so this step can only be done by them.
          </p>
        </div>
      </div>
    </div>
  );
}
