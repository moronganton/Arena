import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexBookingIdFromExternalId } from "@/lib/channels/channex-messages";

// Shows what actually happened to Channex-sourced guest messages on our side:
// what was imported, whether the AI answered, and whether that answer reached
// the guest.
//
// Importing a guest message runs it through processIncomingMessage, which may
// generate a reply and hand it to deliverAiMessage. Three things can then go
// wrong quietly - the AI declines to answer and flags it for the host, the
// reply is written but the channel relay fails, or the assistant is switched
// off for that property - and none of those are visible from the Channex side,
// where the thread just sits with the guest's message as the last entry.
//
//   GET /api/debug/channex-message-state
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const reservations = await prisma.reservation.findMany({
    where: {
      externalId: { startsWith: "channex-" },
      property: { ownerId: userId },
      messages: { some: {} },
    },
    include: {
      guest: { select: { name: true, email: true } },
      property: { select: { name: true, aiEnabled: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { checkIn: "asc" },
  });

  const aiSettings = await prisma.aiSettings.findUnique({ where: { userId }, select: { enabled: true } });

  const threads = reservations.map((r) => ({
    guest: r.guest.name,
    guestEmail: r.guest.email,
    property: r.property.name,
    propertyAiEnabled: r.property.aiEnabled,
    channexBookingId: channexBookingIdFromExternalId(r.externalId ?? ""),
    checkIn: r.checkIn,
    messages: r.messages.map((m) => ({
      direction: m.direction,
      body: m.body.slice(0, 220),
      isAiGenerated: m.isAiGenerated,
      isDraft: m.isDraft,
      needsHostReply: m.needsHostReply,
      channelFailed: m.channelFailed,
      channelError: m.channelError,
      createdAt: m.createdAt,
    })),
  }));

  return NextResponse.json({
    aiAssistantEnabledAccountWide: aiSettings?.enabled ?? null,
    threadsWithMessages: threads.length,
    inboundTotal: threads.reduce((n, t) => n + t.messages.filter((m) => m.direction === "INBOUND").length, 0),
    outboundTotal: threads.reduce((n, t) => n + t.messages.filter((m) => m.direction === "OUTBOUND").length, 0),
    outboundFailed: threads.reduce((n, t) => n + t.messages.filter((m) => m.channelFailed).length, 0),
    awaitingHostReply: threads.reduce((n, t) => n + t.messages.filter((m) => m.needsHostReply).length, 0),
    threads,
  });
}
