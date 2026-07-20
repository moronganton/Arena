import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// Diagnostic: POSTs a uniquely-tagged test message to the guest via Smoobu,
// then immediately reads the thread back through Smoobu's OWN API to check
// whether that 201 actually created a real, retrievable message. Also reports
// which auth scheme we're using (never the secret). This distinguishes:
//   - "201 but our own read-back doesn't see it" → Smoobu isn't persisting it
//     as a real message (request-shape / server-side issue)
//   - "201 and read-back sees it, but guest/OTA doesn't" → downstream relay
//   GET /api/debug/test-send?reservationId=...&text=Hello
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // Unique marker so we can find THIS exact message in the read-back
  const marker = `diag-${Date.now().toString().slice(-6)}`;
  const text = `${searchParams.get("text") || "StayHQ diagnostic — please ignore"} [${marker}]`;
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

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  const cred = parseCredential(account.apiKey);
  // Report the auth scheme in use WITHOUT leaking the secret
  const authInfo = {
    scheme: cred.scheme,
    variant: cred.variant ?? null,
    hasKeyId: Boolean(cred.keyId),
  };

  const sendPath = `/reservations/${smoobuId}/messages/send-message-to-guest`;
  const body = JSON.stringify({ subject: "Message from your host", messageBody: text });

  const started = Date.now();
  let sendResult: Record<string, unknown>;
  try {
    const res = await fetch(`${SMOOBU_BASE_URL}${sendPath}`, {
      method: "POST",
      headers: { ...buildHeaders(cred, "POST", sendPath, body), "Content-Type": "application/json" },
      body,
    });
    const raw = await res.text();
    sendResult = {
      httpStatus: res.status,
      ok: res.ok,
      headers: {
        "retry-after": res.headers.get("retry-after"),
        "x-ratelimit-remaining": res.headers.get("x-ratelimit-remaining"),
      },
      body: raw.slice(0, 400),
    };
  } catch (err) {
    return NextResponse.json({
      reservation: { id: reservation.id, externalId: reservation.externalId },
      authInfo,
      error: err instanceof Error ? err.message : String(err),
      verdict: "Network/transport error reaching Smoobu on SEND.",
    });
  }

  // Give Smoobu a moment, then read the thread back through its own API and
  // look for our unique marker.
  await new Promise((r) => setTimeout(r, 2500));
  const readPath = `/reservations/${smoobuId}/messages?onlyRelatedToGuest=false&pageSize=20&page=1`;
  let readBack: Record<string, unknown>;
  try {
    const res = await fetch(`${SMOOBU_BASE_URL}${readPath}`, {
      headers: { ...buildHeaders(cred, "GET", readPath), "Cache-Control": "no-cache" },
    });
    const data = await res.json().catch(() => ({}));
    const msgs: Array<Record<string, unknown>> = Array.isArray(data) ? data : data.messages || [];
    const found = msgs.some((m) => String(m.message ?? m.messageBody ?? m.body ?? "").includes(marker));
    readBack = {
      httpStatus: res.status,
      totalReturned: msgs.length,
      ourMarkerFound: found,
      lastMessages: msgs.slice(0, 5).map((m) => ({
        type: m.type,
        snippet: String(m.message ?? m.messageBody ?? m.body ?? "").slice(0, 60).replace(/\s+/g, " "),
      })),
    };
  } catch (err) {
    readBack = { error: err instanceof Error ? err.message : String(err) };
  }

  const found = (readBack as { ourMarkerFound?: boolean }).ourMarkerFound;
  return NextResponse.json({
    reservation: { id: reservation.id, externalId: reservation.externalId, guest: reservation.guest.name },
    authInfo,
    marker,
    send: sendResult,
    readBack,
    tookMs: Date.now() - started,
    verdict:
      found === true
        ? "Send created a REAL message — Smoobu's own API reads it back. If the guest/OTA didn't get it, the drop is Smoobu→OTA (but your manual Smoobu send works, so unlikely)."
        : found === false
        ? "Send returned 201 but Smoobu's OWN API does NOT return the message on read-back — the 201 is not creating a real thread message. This is the bug: request shape or auth context, not the OTA."
        : "Could not read the thread back to verify.",
  });
}
