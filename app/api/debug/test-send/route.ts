import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SMOOBU_BASE_URL, parseCredential, buildHeaders } from "@/lib/channels/smoobu-core";

// Diagnostic: sends one test message to the guest via Smoobu and returns the
// RAW Smoobu HTTP status + body, so we can see exactly why relays fail
// (rate limit? bad request? auth?). Bypasses retry/throttle to show the
// first-attempt response.
//   GET /api/debug/test-send?reservationId=...&text=Hello%20test
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text") || "Test message from StayHQ diagnostics — please ignore.";
  const reservationId = searchParams.get("reservationId");

  // Use the given reservation, or the most recent Smoobu-linked one
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
  const path = `/reservations/${smoobuId}/messages/send-message-to-guest`;
  const body = JSON.stringify({ subject: "Message from your host", messageBody: text });
  const cred = parseCredential(account.apiKey);

  const started = Date.now();
  try {
    const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
      method: "POST",
      headers: { ...buildHeaders(cred, "POST", path, body), "Content-Type": "application/json" },
      body,
    });
    const raw = await res.text();
    return NextResponse.json({
      reservation: { id: reservation.id, externalId: reservation.externalId, guest: reservation.guest.name },
      sentText: text,
      smoobu: {
        httpStatus: res.status,
        ok: res.ok,
        headers: {
          "retry-after": res.headers.get("retry-after"),
          "x-ratelimit-remaining": res.headers.get("x-ratelimit-remaining"),
          "x-ratelimit-limit": res.headers.get("x-ratelimit-limit"),
        },
        body: raw.slice(0, 800),
      },
      tookMs: Date.now() - started,
      verdict: res.ok
        ? "Smoobu ACCEPTED the message. If the guest still didn't get it, the drop is downstream at Booking.com/Airbnb."
        : `Smoobu REJECTED with HTTP ${res.status} — this is why the relay fails.`,
    });
  } catch (err) {
    return NextResponse.json({
      reservation: { id: reservation.id, externalId: reservation.externalId },
      error: err instanceof Error ? err.message : String(err),
      verdict: "Network/transport error reaching Smoobu.",
    });
  }
}
