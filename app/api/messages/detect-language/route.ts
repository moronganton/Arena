import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectLanguage } from "@/lib/translate";

// POST { reservationId } — lazily detects the language of every inbound guest
// message on the thread that hasn't been checked yet (detectedLanguage is
// null), so opening a thread lights up the translate pill on foreign-language
// messages without any import-time change or backfill. Already-detected
// messages are skipped — this never re-runs for the same message twice.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reservationId } = await req.json();
  if (!reservationId) return NextResponse.json({ error: "reservationId required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const pending = await prisma.message.findMany({
    where: {
      reservationId,
      direction: "INBOUND",
      channel: { not: "INTERNAL" },
      detectedLanguage: null,
    },
    select: { id: true, body: true },
    take: 30, // a normal thread is a handful of messages; caps a pathological one
  });

  const results = await Promise.all(
    pending.map(async (m) => {
      let language = "English";
      try {
        language = await detectLanguage(m.body);
      } catch (err) {
        // Leave detectedLanguage null on failure so the next thread open retries
        // it, rather than caching a wrong guess forever.
        console.error(`[translate] language detection failed for message ${m.id}:`, err);
        return null;
      }
      await prisma.message.update({ where: { id: m.id }, data: { detectedLanguage: language } });
      return { id: m.id, detectedLanguage: language };
    })
  );

  return NextResponse.json({ detected: results.filter((r): r is { id: string; detectedLanguage: string } => r !== null) });
}
