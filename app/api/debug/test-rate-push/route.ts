import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// Diagnostic: does Smoobu's rate-WRITE API actually apply on this account, or is
// it (like messaging) accepted-but-ignored on the trial? Picks a mapped
// apartment and a far-future date (no bookings there), reads the current price,
// pushes a distinctive test price, reads it back to see if it stuck, then
// restores the original. Safe to run; PriceLabs would re-correct anyway.
//   GET /api/debug/test-rate-push[?apartmentId=123]
const TEST_PRICE = 13579;

async function getRates(cred: ReturnType<typeof parseCredential>, apartmentId: string, date: string) {
  const path = `/rates?apartments=${apartmentId}&start_date=${date}&end_date=${date}`;
  const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
    headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
  });
  const raw = await res.text();
  return { status: res.status, raw };
}

// Best-effort dig for the price at [apartmentId][date] in whatever shape comes back
function extractPrice(raw: string, apartmentId: string, date: string): number | null {
  try {
    const data = JSON.parse(raw);
    const root = data?.data ?? data;
    const apt = root?.[apartmentId] ?? root?.[Number(apartmentId)];
    const day = apt?.[date];
    const p = day?.price ?? day?.daily_price ?? null;
    return typeof p === "number" ? p : p != null && !isNaN(Number(p)) ? Number(p) : null;
  } catch {
    return null;
  }
}

async function postRates(cred: ReturnType<typeof parseCredential>, apartmentId: string, date: string, price: number) {
  const path = `/rates`;
  const body = JSON.stringify({ apartments: [Number(apartmentId)], operations: [{ dates: [date], daily_price: price }] });
  const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...buildHeaders(cred, "POST", path, body), "Content-Type": "application/json" },
    body,
  });
  return { status: res.status, raw: (await res.text()).slice(0, 300) };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const wantApt = new URL(req.url).searchParams.get("apartmentId");
  const mapping = await prisma.channelConfig.findFirst({
    where: { channel: "SMOOBU", property: { ownerId: session.user.id }, ...(wantApt ? { listingId: wantApt } : { listingId: { not: null } }) },
    include: { property: { select: { name: true } } },
  });
  if (!mapping?.listingId) return NextResponse.json({ error: "No Smoobu-mapped apartment found" }, { status: 404 });

  const apartmentId = mapping.listingId;
  const cred = parseCredential(account.apiKey);
  const authInfo = { scheme: cred.scheme, variant: cred.variant ?? null };
  // A date well beyond normal booking windows so nothing real is touched
  const testDate = new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10);

  try {
    const before = await getRates(cred, apartmentId, testDate);
    const originalPrice = extractPrice(before.raw, apartmentId, testDate);

    const post = await postRates(cred, apartmentId, testDate, TEST_PRICE);

    await new Promise((r) => setTimeout(r, 1500));
    const after = await getRates(cred, apartmentId, testDate);
    const applied = extractPrice(after.raw, apartmentId, testDate) === TEST_PRICE || after.raw.includes(String(TEST_PRICE));

    // Restore the original price if we could read it
    let restored: string;
    if (originalPrice != null) {
      const r = await postRates(cred, apartmentId, testDate, originalPrice);
      restored = `restored to ${originalPrice} (HTTP ${r.status})`;
    } else {
      restored = "original price could not be read — NOT restored (a far-future test date; PriceLabs will re-correct)";
    }

    return NextResponse.json({
      apartment: { id: apartmentId, property: mapping.property.name },
      authInfo,
      testDate,
      testPrice: TEST_PRICE,
      originalPriceRead: originalPrice,
      post: { httpStatus: post.status, body: post.raw },
      readBack: { httpStatus: after.status, sample: after.raw.slice(0, 400) },
      applied,
      restored,
      verdict: applied
        ? "Rate WRITE works — Smoobu applied the test price and read it back. Pricing push from StayHQ is technically possible on this account."
        : `Rate write did NOT take effect (POST HTTP ${post.status}, but read-back doesn't show the test price). Same pattern as messaging — likely gated on the trial / requires a paid plan.`,
    });
  } catch (err) {
    return NextResponse.json({ apartment: { id: apartmentId }, authInfo, error: err instanceof Error ? err.message : String(err) });
  }
}
