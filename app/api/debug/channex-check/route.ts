import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Read-only Channex.io validation: authenticates with a Channex API key and
// pulls the first page of Properties, Bookings, and Messages, so we can confirm
// the key works and see the real data shapes before scoping a migration.
// Nothing is written to Channex.
//   GET /api/debug/channex-check?apiKey=CHANNEX_KEY&env=staging
const BASES: Record<string, string> = {
  staging: "https://staging.channex.io/api/v1",
  prod: "https://secure.channex.io/api/v1",
};

async function hit(base: string, path: string, apiKey: string) {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "user-api-key": apiKey, "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });
    const raw = await res.text();
    let count: number | null = null;
    try {
      const j = JSON.parse(raw);
      count = Array.isArray(j?.data) ? j.data.length : null;
    } catch {
      /* non-JSON body */
    }
    return { path, httpStatus: res.status, ok: res.ok, count, sample: raw.slice(0, 800) };
  } catch (err) {
    return { path, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const apiKey = searchParams.get("apiKey") || process.env.CHANNEX_API_KEY;
  const env = searchParams.get("env") === "prod" ? "prod" : "staging";
  if (!apiKey) {
    return NextResponse.json({ error: "Provide ?apiKey=<your Channex API key> (get it in Channex → Account → API Key Access)" }, { status: 400 });
  }
  const base = BASES[env];

  // Properties first — it's the cheapest auth check.
  const properties = await hit(base, "/properties", apiKey);
  const bookings = await hit(base, "/bookings", apiKey);
  const messages = await hit(base, "/messages", apiKey);

  return NextResponse.json({
    env,
    base,
    auth: properties.ok ? "OK — the Channex API key authenticates" : `FAILED (HTTP ${properties.httpStatus ?? "?"})`,
    properties,
    bookings,
    messages,
    verdict: properties.ok
      ? "Channex authenticates. Check the sample payloads: 'properties' shows your listings, 'bookings' the reservation shape, 'messages' the guest-messaging threads — these map to StayHQ's SmoobuAccount / Reservation / Message models."
      : "Key did not authenticate — double-check the API key and that env matches where the key was issued (staging vs prod).",
  });
}
