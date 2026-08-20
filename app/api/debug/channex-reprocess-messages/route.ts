import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/ai";

// Re-runs the inbound handler for Channex guest messages that were imported
// before it notified the host on an AI-disabled property.
//
// Those messages are stuck: the importer dedupes on externalId so re-polling
// skips them, yet they were never flagged and the host was never told. This
// puts them back through the real handler rather than setting the flag
// directly, so whatever the current settings say happens - which on an
// AI-disabled property means flag and notify, and on an AI-enabled one means
// the assistant answers.
//
// That second case is the reason this needs confirming: pointed at a property
// with the assistant switched on, it will generate and may send real replies
// to messages that are already old.
//
//   GET /api/debug/channex-reprocess-messages            -> dry run
//   GET /api/debug/channex-reprocess-messages?confirm=true -> re-runs them
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const candidates = await prisma.message.findMany({
    where: {
      direction: "INBOUND",
      externalId: { startsWith: "channex-msg-" },
      needsHostReply: false,
      reservation: { property: { ownerId: userId } },
    },
    include: {
      reservation: {
        include: {
          guest: { select: { name: true } },
          property: { select: { name: true, aiEnabled: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // A message already followed by a reply in its thread was handled; only the
  // ones with nothing after them are genuinely unanswered.
  const unanswered = [];
  for (const m of candidates) {
    const laterOutbound = await prisma.message.count({
      where: { reservationId: m.reservationId, direction: "OUTBOUND", createdAt: { gt: m.createdAt } },
    });
    if (laterOutbound === 0) unanswered.push(m);
  }

  const plan = unanswered.map((m) => ({
    messageId: m.id,
    guest: m.reservation.guest.name,
    propertyAiEnabled: m.reservation.property.aiEnabled,
    body: m.body.slice(0, 120),
  }));

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing changed",
      channexInboundTotal: candidates.length,
      unanswered: plan.length,
      willGenerateAiReplies: plan.some((p) => p.propertyAiEnabled),
      plan,
    });
  }

  const results = [];
  for (const m of unanswered) {
    try {
      await processIncomingMessage(m.id);
      results.push({ messageId: m.id, guest: m.reservation.guest.name, status: "reprocessed" });
    } catch (err) {
      results.push({
        messageId: m.id,
        guest: m.reservation.guest.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ applied: true, reprocessed: results.length, results });
}
