import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { smoobuFetch } from "@/lib/channels/smoobu-core";

// Diagnostic: shows the raw Smoobu message thread next to what StayHQ has
// imported, for the most recent active Smoobu reservation (or ?externalId=).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const externalIdParam = searchParams.get("externalId");

  const reservation = await prisma.reservation.findFirst({
    where: {
      property: { ownerId: session.user.id },
      ...(externalIdParam
        ? { externalId: externalIdParam }
        : { externalId: { startsWith: "smoobu-" }, status: { not: "CANCELLED" } }),
    },
    orderBy: { createdAt: "desc" },
    include: { guest: { select: { name: true } } },
  });
  if (!reservation?.externalId) {
    return NextResponse.json({ error: "No Smoobu reservation found" }, { status: 404 });
  }

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  let raw: unknown;
  let fetchError: string | null = null;
  try {
    raw = await smoobuFetch(account.apiKey, `/reservations/${smoobuId}/messages?onlyRelatedToGuest=false`);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  const stayhqMessages = await prisma.message.findMany({
    where: { reservationId: reservation.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      externalId: true,
      direction: true,
      channel: true,
      source: true,
      isRead: true,
      createdAt: true,
      body: true,
    },
  });

  return NextResponse.json({
    reservation: {
      externalId: reservation.externalId,
      guest: reservation.guest.name,
    },
    smoobuRawThread: raw ?? null,
    smoobuFetchError: fetchError,
    stayhqMessages: stayhqMessages.map((m) => ({
      ...m,
      body: m.body.slice(0, 80),
    })),
  });
}
