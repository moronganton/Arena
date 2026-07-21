import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// Finds the GET /rates format that actually works on this account, so we can
// build a read-only pricing calendar. Tries several param encodings + endpoint
// shapes for a near-future date range (where PriceLabs has set real prices) and
// reports the status + body of each, so we can see which returns rate data.
//   GET /api/debug/test-rate-read[?apartmentId=123]
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const wantApt = new URL(req.url).searchParams.get("apartmentId");
  const mapping = await prisma.channelConfig.findFirst({
    where: { channel: "SMOOBU", property: { ownerId: session.user.id }, ...(wantApt ? { listingId: wantApt } : { listingId: { not: null } }) },
  });
  if (!mapping?.listingId) return NextResponse.json({ error: "No Smoobu-mapped apartment found" }, { status: 404 });

  const id = mapping.listingId;
  const cred = parseCredential(account.apiKey);
  const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 34 * 86400000).toISOString().slice(0, 10);

  // Each candidate path — signed and sent identically so HMAC matches the wire.
  const candidates: { name: string; path: string }[] = [
    { name: "encoded-brackets", path: `/rates?apartments%5B%5D=${id}&start_date=${start}&end_date=${end}` },
    { name: "raw-brackets", path: `/rates?apartments[]=${id}&start_date=${start}&end_date=${end}` },
    { name: "scalar", path: `/rates?apartments=${id}&start_date=${start}&end_date=${end}` },
    { name: "no-filter", path: `/rates?start_date=${start}&end_date=${end}` },
    { name: "nested", path: `/apartments/${id}/rates?start_date=${start}&end_date=${end}` },
  ];

  const results = [];
  for (const c of candidates) {
    try {
      const res = await fetch(`${SMOOBU_BASE_URL}${c.path}`, {
        headers: { ...buildHeaders(cred, "GET", c.path), "Cache-Control": "no-cache" },
      });
      const raw = await res.text();
      results.push({ variant: c.name, httpStatus: res.status, ok: res.ok, body: raw.slice(0, 350) });
    } catch (err) {
      results.push({ variant: c.name, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const winner = results.find((r) => r.ok);
  return NextResponse.json({
    apartment: id,
    dateRange: `${start} … ${end}`,
    authScheme: cred.scheme,
    results,
    winner: winner ? winner.variant : null,
    verdict: winner
      ? `Use the "${winner.variant}" format — it returned rate data. I'll build the read-only calendar on it.`
      : "None of the formats returned data — I'll need the exact GET /rates spec from Smoobu's docs.",
  });
}
