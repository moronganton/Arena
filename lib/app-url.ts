import { NextRequest } from "next/server";

// Behind Railway's proxy the request URL is the internal address, so this
// prefers NEXTAUTH_URL (configured with the public domain) and only falls
// back to forwarded headers or the raw request URL - same logic
// app/api/webhook-url/route.ts already established, pulled out here so the
// Stripe/Channex OAuth redirect URLs (which must be a real public HTTPS
// address, not an internal one) use the identical resolution.
export function resolveAppOrigin(req: NextRequest): string {
  const configured = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  if (configured && !configured.includes("localhost")) return configured;
  if (forwardedHost && !forwardedHost.includes("localhost")) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}
