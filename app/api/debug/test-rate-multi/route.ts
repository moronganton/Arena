import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// getSmoobuRatesMulti (used by the Calendar's live-price overlay) combines
// several apartment ids into ONE /rates call using the same
// apartments%5B%5D=<id> format that was verified for a SINGLE apartment in
// test-rate-read — but that combination was never actually tried against a
// real account with more than one mapped apartment. It now returns HTTP 422,
// and Smoobu's 422s have historically meant "the apartment filter wasn't
// understood" (see test-rate-push), not an auth or plan problem.
//
// This finds which multi-apartment encoding (if any) Smoobu actually accepts,
// and separately confirms the known-good single-apartment call still works
// for every mapped property — so there is a guaranteed fallback (N sequential
// calls) even if no batched format works at all.
//   GET /api/debug/test-rate-multi
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const mappings = await prisma.channelConfig.findMany({
    where: { channel: "SMOOBU", listingId: { not: null }, property: { ownerId: session.user.id } },
    include: { property: { select: { name: true } } },
  });
  if (mappings.length === 0) {
    return NextResponse.json({ error: "No Smoobu-mapped properties found" }, { status: 404 });
  }

  const ids = mappings.map((m) => m.listingId!) as string[];
  const cred = parseCredential(account.apiKey);
  const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 34 * 86400000).toISOString().slice(0, 10);

  async function call(path: string) {
    const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
      headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
    });
    const raw = await res.text();
    return { httpStatus: res.status, ok: res.ok, body: raw.slice(0, 400) };
  }

  // Only meaningful with 2+ mapped apartments — with one, the existing
  // single-apartment call already covers it and there is nothing to batch.
  const multiResults: Array<{ variant: string } & Awaited<ReturnType<typeof call>>> = [];
  if (ids.length > 1) {
    const candidates: { name: string; path: string }[] = [
      { name: "repeated-encoded-brackets (current code)", path: `/rates?${ids.map((id) => `apartments%5B%5D=${id}`).join("&")}&start_date=${start}&end_date=${end}` },
      { name: "repeated-raw-brackets", path: `/rates?${ids.map((id) => `apartments[]=${id}`).join("&")}&start_date=${start}&end_date=${end}` },
      { name: "comma-in-brackets", path: `/rates?apartments%5B%5D=${ids.join(",")}&start_date=${start}&end_date=${end}` },
      { name: "comma-scalar", path: `/rates?apartments=${ids.join(",")}&start_date=${start}&end_date=${end}` },
      { name: "no-filter (all apartments on account)", path: `/rates?start_date=${start}&end_date=${end}` },
    ];
    for (const c of candidates) {
      try {
        multiResults.push({ variant: c.name, ...(await call(c.path)) });
      } catch (err) {
        multiResults.push({ variant: c.name, httpStatus: 0, ok: false, body: err instanceof Error ? err.message : String(err) });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // Confirm the known-good single-apartment format for EVERY mapped property,
  // regardless of what the batch tests show — this is the fallback either way.
  const perApartment: Array<{ property: string; apartmentId: string } & Awaited<ReturnType<typeof call>>> = [];
  for (const m of mappings) {
    const path = `/rates?apartments%5B%5D=${m.listingId}&start_date=${start}&end_date=${end}`;
    try {
      perApartment.push({ property: m.property.name, apartmentId: m.listingId!, ...(await call(path)) });
    } catch (err) {
      perApartment.push({ property: m.property.name, apartmentId: m.listingId!, httpStatus: 0, ok: false, body: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const batchWinner = multiResults.find((r) => r.ok);
  const allSingleOk = perApartment.every((r) => r.ok);

  return NextResponse.json({
    mappedApartments: mappings.map((m) => ({ property: m.property.name, apartmentId: m.listingId })),
    dateRange: `${start} … ${end}`,
    multiApartmentTests: ids.length > 1 ? multiResults : "skipped — only one mapped apartment, nothing to batch",
    perApartmentSingleCalls: perApartment,
    verdict: batchWinner
      ? `Use "${batchWinner.variant}" for the batch call — it returned data for all apartments in one request.`
      : allSingleOk
      ? "No batched format worked, but every single-apartment call succeeded. Fix: fetch rates per-apartment in parallel instead of one combined call — same result, one request per property."
      : "Some single-apartment calls also failed — that points at specific apartment mappings (stale listingId) rather than the batching format. Check perApartmentSingleCalls for which property failed and why.",
  });
}
