import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexBookingIdFromExternalId, fetchBookingMessages } from "@/lib/channels/channex-messages";
import { relayMessageToChannel } from "@/lib/channels/relay";

// Delivers outbound messages that were written before the relay covered
// Channex, and so never left the database.
//
// Which ones those are is decided by comparing against the real thread rather
// than by trusting a flag: those messages were never attempted, so
// channelFailed is false on all of them and looks identical to a successful
// send. For each outbound message this reads the booking's Channex thread and
// resends only when no message from the property side carries the same text.
//
// Comparison is on normalised text because the two sides differ in
// whitespace - Channex returns messages with a trailing newline.
//
//   GET /api/debug/channex-resend-unrelayed            -> dry run
//   GET /api/debug/channex-resend-unrelayed?confirm=true -> sends the missing ones
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const messages = await prisma.message.findMany({
    where: {
      direction: "OUTBOUND",
      channel: { not: "INTERNAL" }, // internal notes are private and must never be sent
      reservation: { externalId: { startsWith: "channex-" }, property: { ownerId: userId } },
    },
    include: {
      reservation: {
        select: { id: true, externalId: true, guest: { select: { name: true } }, property: { select: { ownerId: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // One thread read per booking, not per message.
  const threadCache = new Map<string, Set<string>>();
  async function propertyTextsFor(bookingId: string): Promise<Set<string> | null> {
    const cached = threadCache.get(bookingId);
    if (cached) return cached;
    try {
      const thread = await fetchBookingMessages(bookingId);
      const texts = new Set(
        thread.filter((m) => m.attributes.sender === "property").map((m) => normalise(m.attributes.message ?? ""))
      );
      threadCache.set(bookingId, texts);
      return texts;
    } catch {
      return null; // thread unreadable - treated as "cannot tell", never resent blindly
    }
  }

  const plan: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const bookingId = channexBookingIdFromExternalId(m.reservation.externalId ?? "");
    if (!bookingId) {
      plan.push({ messageId: m.id, guest: m.reservation.guest.name, action: "skip", reason: "no Channex booking id" });
      continue;
    }
    const sentTexts = await propertyTextsFor(bookingId);
    if (sentTexts === null) {
      plan.push({ messageId: m.id, guest: m.reservation.guest.name, action: "skip", reason: "could not read the Channex thread" });
      continue;
    }
    const alreadyThere = sentTexts.has(normalise(m.body));
    plan.push({
      messageId: m.id,
      guest: m.reservation.guest.name,
      action: alreadyThere ? "already-delivered" : "resend",
      body: m.body.slice(0, 100),
      createdAt: m.createdAt,
    });
  }

  const toResend = plan.filter((p) => p.action === "resend");

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing sent",
      outboundChecked: messages.length,
      alreadyDelivered: plan.filter((p) => p.action === "already-delivered").length,
      toResend: toResend.length,
      skipped: plan.filter((p) => p.action === "skip").length,
      plan,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const p of toResend) {
    const m = messages.find((x) => x.id === p.messageId);
    if (!m) continue;
    const relay = await relayMessageToChannel(
      { externalId: m.reservation.externalId, ownerId: m.reservation.property.ownerId },
      m.body
    );
    if (relay.status === "failed") {
      await prisma.message.update({
        where: { id: m.id },
        data: { channelFailed: true, channelError: relay.error.slice(0, 300) },
      });
    }
    results.push({ messageId: m.id, guest: m.reservation.guest.name, outcome: relay });
  }

  return NextResponse.json({ applied: true, resent: results.length, results });
}
