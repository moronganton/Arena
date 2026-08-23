import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { resolveAppOrigin } from "@/lib/app-url";

// The Channex Stripe-connect redirect just landed on localhost:8080 instead
// of the real deployed domain, even though NEXTAUTH_URL is supposed to make
// resolveAppOrigin immune to Railway's internal-address problem. This
// reports every input the function actually saw for a real request, to see
// which fallback fired instead of guessing.
//
//   GET /api/debug/app-origin-check
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  return NextResponse.json({
    resolved: resolveAppOrigin(req),
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
    headers: {
      "x-forwarded-host": req.headers.get("x-forwarded-host"),
      host: req.headers.get("host"),
      "x-forwarded-proto": req.headers.get("x-forwarded-proto"),
    },
    rawRequestUrl: req.url,
  });
}
