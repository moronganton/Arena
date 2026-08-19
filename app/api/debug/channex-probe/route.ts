import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Read-only reconnaissance against the Channex API, run from Railway.
//
// This exists because the development sandbox's egress policy blocks every
// channex.io host, so the API shapes can't be confirmed there - not from the
// API itself and not from the docs. Rather than build lib/channels/channex-
// core.ts on assumptions, this probe reports what the API actually returns,
// the same empirical approach the Smoobu integration was built with.
//
// Strictly GET requests. Nothing is created, modified, or deleted.
//
//   GET /api/debug/channex-probe
//   GET /api/debug/channex-probe?path=/properties   (probe one specific path)
//
// The API key is never echoed back - only whether it is present and its
// length, so a missing/truncated env var is diagnosable without leaking it.

const DEFAULT_BASE = "https://staging.channex.io/api/v1";

// Channex documents a `user-api-key` header. The alternatives are probed too
// so the correct scheme is established from real responses rather than
// assumed - mirroring how smoobu-core.ts settled its auth variants.
function authVariants(key: string): Array<{ label: string; headers: Record<string, string> }> {
  return [
    { label: "user-api-key", headers: { "user-api-key": key } },
    { label: "Authorization: Bearer", headers: { Authorization: `Bearer ${key}` } },
    { label: "api-key", headers: { "api-key": key } },
  ];
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const key = process.env.CHANNEX_API_KEY || "";
  const base = (process.env.CHANNEX_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const probePath = new URL(req.url).searchParams.get("path") || "/properties";

  if (!key) {
    return NextResponse.json({
      error: "CHANNEX_API_KEY is not set on this deployment",
      hint: "Add CHANNEX_API_KEY and CHANNEX_BASE_URL in Railway's Variables tab, then redeploy.",
      baseUrlInUse: base,
    }, { status: 400 });
  }

  const url = `${base}${probePath.startsWith("/") ? probePath : `/${probePath}`}`;
  const results = [];

  for (const variant of authVariants(key)) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { ...variant.headers, "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Leave null - the raw excerpt below still shows what came back.
      }
      results.push({
        authVariant: variant.label,
        status: res.status,
        ok: res.ok,
        tookMs: Date.now() - started,
        contentType: res.headers.get("content-type"),
        // Truncated so a large listing can't flood the response.
        bodyExcerpt: text.slice(0, 1500),
        parsedTopLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed as object) : null,
      });
    } catch (err) {
      results.push({
        authVariant: variant.label,
        status: null,
        ok: false,
        tookMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const working = results.find((r) => r.ok);
  return NextResponse.json({
    probed: url,
    apiKeyPresent: true,
    apiKeyLength: key.length,
    baseUrlInUse: base,
    baseUrlFromEnv: !!process.env.CHANNEX_BASE_URL,
    workingAuthVariant: working ? working.authVariant : null,
    verdict: working
      ? `Auth works using the "${working.authVariant}" header.`
      : "No auth variant succeeded - check the key, the base URL, and the status codes below.",
    results,
  });
}
