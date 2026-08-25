import type { NextConfig } from "next";

// Security headers, applied to every response.
//
// Scoped from what the app actually does, not a generic template - checked
// against real usage before writing this: one iframe embed (Channex's own
// mapping UI, origin varies with CHANNEX_BASE_URL so it can't be a fixed
// allow-list entry - see connect-src/frame-src below), no client-side fetch
// to any external host, no external stylesheet or script tag anywhere in
// the app. That is what makes a real CSP possible here rather than a
// report-only placeholder.
const channexOrigin = "https://*.channex.io";

const securityHeaders = [
  // The app is never meant to be embedded by anyone else's page. Channex
  // embeds INTO us (frame-src, below); nothing embeds us.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Full URL never leaves the app on an outbound link - reservation and
  // property IDs live in the path, and Booking.com/Airbnb/TTLock docs are
  // the only external links in the app.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses camera, microphone, geolocation or payment APIs.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js's inline hydration bootstrap needs this; it does not relax
      // where scripts can be LOADED from, only that an inline one may run.
      "script-src 'self' 'unsafe-inline'",
      // Tailwind's runtime and Next.js inject inline styles.
      "style-src 'self' 'unsafe-inline'",
      // next/image proxies Google/GitHub avatars through /_next/image, so
      // the browser only ever requests images same-origin plus data: URIs
      // used for attachments and photos stored inline.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Where the app itself calls out: Channex's API/webapp, Stripe
      // Checkout (dormant until Phase 12, listed now so turning it on is
      // not also a CSP change), and the app's own websocket in dev.
      `connect-src 'self' ${channexOrigin} https://api.stripe.com`,
      // The one embed in the app: the Channex mapping iframe.
      `frame-src ${channexOrigin} https://js.stripe.com`,
      "base-uri 'self'",
      "form-action 'self'",
      // Belt-and-braces alongside X-Frame-Options - CSP is what modern
      // browsers actually consult first.
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  images: {
    domains: ["lh3.googleusercontent.com", "avatars.githubusercontent.com"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
