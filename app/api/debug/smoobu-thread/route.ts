import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { smoobuFetch } from "@/lib/channels/smoobu-core";

// Temporary diagnostic: shows the raw Smoobu message thread next to StayHQ's
// imported rows so direction-mapping issues can be inspected without log access.
// GET /api/debug/smoobu-thread?reservationId=...
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    select: { id: true, externalId: true },
  });
  if (!reservation?.externalId?.startsWith("smoobu-")) {
    return NextResponse.json({ error: "Not a Smoobu-linked reservation" }, { status: 404 });
  }

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 404 });

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  const smoobuRaw: Array<Record<string, unknown>> = [];
  let page = 1;
  let pageCount = 1;
  while (page <= Math.min(pageCount, 20)) {
    const data = await smoobuFetch(
      account.apiKey,
      `/reservations/${smoobuId}/messages?onlyRelatedToGuest=false&pageSize=100&page=${page}`
    );
    if (Array.isArray(data)) {
      smoobuRaw.push(...data);
      break;
    }
    pageCount = Number(data.page_count) || 1;
    const batch: Array<Record<string, unknown>> = data.messages || [];
    smoobuRaw.push(...batch);
    if (batch.length === 0) break;
    page++;
  }

  const rows = await prisma.message.findMany({
    where: { reservationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      externalId: true,
      direction: true,
      source: true,
      isDraft: true,
      isAiGenerated: true,
      senderId: true,
      createdAt: true,
      body: true,
    },
  });

  return NextResponse.json({
    // Full raw payloads minus the bulky HTML variant of the body
    // (kept as a boolean — it drives the direction heuristic)
    smoobuRaw: smoobuRaw.map((m) => {
      const { messageHtml: _a, htmlMessage: _b, ...rest } = m;
      return { ...rest, hasHtmlBody: !!String(m.htmlMessage ?? m.messageHtml ?? "").trim() };
    }),
    stayhq: rows.map((r) => ({ ...r, body: r.body.slice(0, 100) })),
  });
}
