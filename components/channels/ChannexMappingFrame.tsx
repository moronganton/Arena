"use client";
import { useCallback, useEffect, useState } from "react";
import { X, ExternalLink, Plug, RefreshCw } from "lucide-react";

// Full-screen overlay hosting Channex's own channel/mapping UI inside StayHQ.
//
// The token behind the URL is single-use and short-lived, so it is minted on
// open (not on page load) and dropped on close - reopening mints a fresh one.
// That also means the iframe src must never be rebuilt mid-session from the
// same token, hence url lives in state and is only set once per mint.
//
// Branding has a hard boundary here: Channex's embed API has no theming or
// custom-CSS parameter (checked against their Channel IFrame docs), and the
// frame is cross-origin, so the page INSIDE stays Channex-rendered.
// `app_mode=headless` already strips their navigation chrome; everything
// around the frame - header, loading, errors, footer - is ours, and styling
// that surface consistently is what makes the handoff feel intentional
// instead of like a portal to another product.
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
  // Fades the iframe in only after its document has loaded, so the user sees
  // our branded skeleton, then the finished screen - never Channex's own
  // white flash and redirect hop in between.
  const [frameReady, setFrameReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    setFrameReady(false);
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
  }, [propertyId, attempt]);

  // A failed mint or a dead frame can't be recovered by reloading the iframe:
  // the token was consumed (or never issued). Retry mints a fresh one.
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-stretch md:items-center md:justify-center md:p-6">
      <div className="bg-white w-full md:max-w-6xl md:rounded-2xl flex flex-col overflow-hidden md:h-[90vh] md:shadow-2xl">
        {/* Brand accent: the same terracotta the rest of the app leads with,
            as a hairline across the top of the sheet. */}
        <div className="h-1 bg-indigo-600 shrink-0" />

        <div className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Plug className="w-[18px] h-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900 truncate">Channels &mdash; {propertyName}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Connect an OTA, then map its rooms and rates to this property
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 relative bg-slate-50">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md w-full text-center space-y-4">
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-left">
                  {error}
                </p>
                <button
                  onClick={retry}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Branded skeleton shown while the token is minted and the
                  Channex document loads. Shaped like the channel list that
                  will replace it, so the swap reads as content arriving. */}
              {!frameReady && (
                <div className="absolute inset-0 p-6 space-y-4" aria-hidden>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
                    <p className="text-sm text-slate-500">Preparing your channel manager&hellip;</p>
                  </div>
                  <div className="space-y-3 pt-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 animate-pulse" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-1/3 bg-slate-100 rounded animate-pulse" />
                          <div className="h-2.5 w-1/2 bg-slate-50 rounded animate-pulse" />
                        </div>
                        <div className="h-7 w-20 bg-indigo-50 rounded-lg animate-pulse" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {url && (
                <iframe
                  src={url}
                  title={`Channel mapping for ${propertyName}`}
                  onLoad={() => setFrameReady(true)}
                  // Channex's Airbnb flow offers a "Copy Link" handoff for
                  // hosts who authorize the connection themselves; without
                  // this permission the button silently does nothing.
                  allow="clipboard-read; clipboard-write"
                  className={`w-full h-full border-0 bg-white transition-opacity duration-300 ${
                    frameReady ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
            </>
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
