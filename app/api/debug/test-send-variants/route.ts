import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders, HMAC_VARIANTS } from "@/lib/channels/smoobu-core";

// Diagnostic: our current HMAC signing variant is chosen by connect() based
// only on a GET check succeeding. Reads are lenient, so we may have locked
// onto a variant that signs writes wrongly — Smoobu accepts them (201) but
// discards them. This tries EACH HMAC variant for the send, then reads the
// thread back to see which variant's message Smoobu actually persisted.
//   GET /api/debug/test-send-variants?reservationId=...
//
// If exactly one variant's marker is found, that's the correct signing variant
// and the fix is to store it. If none are found, the issue isn't the variant.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");

  const reservation = await prisma.reservation.findFirst({
    where: {
      property: { ownerId: session.user.id },
      externalId: { startsWith: "smoobu-" },
      ...(reservationId ? { id: reservationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, externalId: true, guest: { select: { name: true } } },
  });
  if (!reservation?.externalId) {
    return NextResponse.json({ error: "No Smoobu-linked reservation found" }, { status: 404 });
  }

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const stored = parseCredential(account.apiKey);
  if (stored.scheme !== "hmac") {
    return NextResponse.json({
      note: `This account uses scheme "${stored.scheme}", not hmac — variant sweep only applies to hmac. No change needed here.`,
      authInfo: { scheme: stored.scheme },
    });
  }

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  const sendPath = `/reservations/${smoobuId}/messages/send-message-to-guest`;

  // Send one uniquely-marked message per variant
  const sends: Array<{ variant: number; marker: string; httpStatus: number; body: string }> = [];
  for (let v = 0; v < HMAC_VARIANTS.length; v++) {
    const marker = `var${v}-${Date.now().toString().slice(-5)}`;
    const cred = { ...stored, variant: v };
    const text = `StayHQ variant probe — please ignore [${marker}]`;
    const body = JSON.stringify({ subject: "Message from your host", messageBody: text });
    try {
      const res = await fetch(`${SMOOBU_BASE_URL}${sendPath}`, {
        method: "POST",
        headers: { ...buildHeaders(cred, "POST", sendPath, body), "Content-Type": "application/json" },
        body,
      });
      sends.push({ variant: v, marker, httpStatus: res.status, body: (await res.text()).slice(0, 120) });
    } catch (err) {
      sends.push({ variant: v, marker, httpStatus: 0, body: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  // Read the thread back (using the known-working stored variant) and see which
  // markers actually landed.
  await new Promise((r) => setTimeout(r, 2500));
  const readPath = `/reservations/${smoobuId}/messages?onlyRelatedToGuest=false&pageSize=30&page=1`;
  let landedMarkers: string[] = [];
  let readError: string | null = null;
  try {
    const res = await fetch(`${SMOOBU_BASE_URL}${readPath}`, {
      headers: { ...buildHeaders(stored, "GET", readPath), "Cache-Control": "no-cache" },
    });
    const data = await res.json().catch(() => ({}));
    const msgs: Array<Record<string, unknown>> = Array.isArray(data) ? data : data.messages || [];
    const all = msgs.map((m) => String(m.message ?? m.messageBody ?? m.body ?? ""));
    landedMarkers = sends.map((s) => s.marker).filter((mk) => all.some((t) => t.includes(mk)));
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  const workingVariant = sends.find((s) => landedMarkers.includes(s.marker))?.variant ?? null;

  return NextResponse.json({
    reservation: { id: reservation.id, externalId: reservation.externalId, guest: reservation.guest.name },
    currentStoredVariant: stored.variant ?? 0,
    sends: sends.map((s) => ({ variant: s.variant, httpStatus: s.httpStatus, landed: landedMarkers.includes(s.marker) })),
    readError,
    workingVariant,
    verdict:
      workingVariant != null
        ? `FOUND IT: HMAC variant ${workingVariant} actually creates a real message (currently stored: ${stored.variant ?? 0}). The fix is to store variant ${workingVariant}.`
        : landedMarkers.length === 0
        ? "No variant produced a retrievable message — the problem is NOT the HMAC variant. Points to a Smoobu-side issue for this endpoint."
        : "Ambiguous result.",
  });
}
