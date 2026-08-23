import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/ai";
import { sendMessageToGuest } from "@/lib/notifications";
import { smoobuProvider } from "@/lib/channels/smoobu-provider";
import { relayMessageToChannel } from "@/lib/channels/relay";
import { detectLanguage, translateToEnglish } from "@/lib/translate";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reservationId = searchParams.get("reservationId");
  const unreadOnly = searchParams.get("unread") === "true";

  // When viewing a specific thread, pull the latest messages from Smoobu first
  // so guest replies from Booking.com/Airbnb appear without waiting for a sync
  if (reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, property: { ownerId: session!.user!.id } },
      select: { id: true, externalId: true },
    });
    if (reservation?.externalId?.startsWith("smoobu-")) {
      try {
        const newIds = await smoobuProvider.syncMessagesForReservation(session!.user!.id!, reservation);
        // One reply per message (yesterday's behavior)
        for (const id of newIds) {
          await processIncomingMessage(id);
        }
      } catch (err) {
        console.error("On-demand Smoobu message sync failed:", err);
      }
    }
  }

  const messages = await prisma.message.findMany({
    where: {
      reservation: { property: { ownerId: session!.user!.id } },
      ...(reservationId ? { reservationId } : {}),
      ...(unreadOnly ? { isRead: false, direction: "INBOUND" } : {}),
    },
    include: {
      reservation: {
        include: {
          guest: true,
          property: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { reservationId, messageBody, internal, channel, replyToId, saveToKnowledge, attachment } = body;
  // Internal notes are private: saved to the thread, never emailed or relayed
  const isInternal = internal === true || channel === "INTERNAL";

  if (!messageBody?.trim() && !attachment) {
    return NextResponse.json({ error: "messageBody or attachment is required" }, { status: 400 });
  }
  // The real caption, which may legitimately be empty when a photo is sent
  // with no text - Channex's own docs: message "can be empty, if attachments
  // is present". This is what actually gets stored and relayed, so a photo
  // sent to Booking.com/Airbnb shows only the photo, not a fabricated
  // "Sent a photo" text bubble alongside it.
  const captionText: string = messageBody?.trim() || "";
  // Only for contexts that can't carry the image at all and so need some
  // text regardless - the guest's email (the photo isn't attached to it,
  // see below) and the property knowledge base entry.
  const textFallback: string = captionText || "Sent a photo";

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session!.user!.id } },
    include: { guest: true, property: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const message = await prisma.message.create({
    data: {
      body: captionText,
      direction: "OUTBOUND",
      channel: isInternal ? "INTERNAL" : "PLATFORM",
      reservationId,
      senderId: session!.user!.id,
      attachments: attachment ? JSON.stringify([attachment]) : null,
    },
    include: { reservation: { include: { guest: true, property: true } } },
  });

  if (isInternal) {
    return NextResponse.json({ ...message, channelRelay: null, knowledgeSaved: false }, { status: 201 });
  }

  // The host replied — clear any "AI couldn't answer" highlights in this thread
  await prisma.message.updateMany({
    where: { reservationId, direction: "INBOUND", needsHostReply: true },
    data: { needsHostReply: false },
  });

  // Store the question + this answer in the property knowledge base so the
  // AI can answer similar questions on its own next time
  let knowledgeSaved = false;
  if (saveToKnowledge && replyToId) {
    const question = await prisma.message.findFirst({
      where: { id: replyToId, reservationId, direction: "INBOUND" },
    });
    if (question) {
      // The knowledge base must always end up in English, whether or not the
      // host happened to tap the Translate pill first. Prefer an already-
      // cached translation; otherwise find out for certain what language this
      // is (rather than assuming "not English yet" means "non-English") and
      // translate only if it actually needs it.
      let questionText = question.translatedBody;
      if (!questionText) {
        let language = question.detectedLanguage;
        if (!language) {
          try {
            language = await detectLanguage(question.body);
          } catch (err) {
            console.error("Failed to detect question language for knowledge base save:", err);
          }
        }
        if (language && language !== "English") {
          try {
            questionText = await translateToEnglish(question.body);
            // Cache both on the message, so the thread's Translate pill
            // reflects the same text and this question is never re-processed.
            await prisma.message.update({
              where: { id: question.id },
              data: { translatedBody: questionText, detectedLanguage: language },
            });
          } catch (err) {
            console.error("Failed to translate question for knowledge base save:", err);
          }
        } else if (language === "English" && !question.detectedLanguage) {
          // Genuinely English — nothing to translate, just cache the check.
          await prisma.message.update({ where: { id: question.id }, data: { detectedLanguage: "English" } }).catch(() => {});
        }
      }
      questionText = questionText || question.body; // detection/translation failed — save something rather than nothing

      await prisma.propertyKnowledge.create({
        data: {
          propertyId: reservation.propertyId,
          category: "FAQ",
          title: questionText.replace(/\s+/g, " ").trim().slice(0, 100),
          content: textFallback,
        },
      });
      knowledgeSaved = true;
    }
  }

  // Send via email if guest has email address. The actual photo isn't
  // attached to the email itself (out of scope for now) - the guest sees it
  // on the booking channel via the relay below, or in StayHQ if they reply.
  if (reservation.guest.email) {
    await sendMessageToGuest({
      guestName: reservation.guest.name,
      guestEmail: reservation.guest.email,
      propertyName: reservation.property.name,
      messageBody: textFallback,
      reservationId,
    });
  }

  // Relay to whichever channel the booking came from (Booking.com / Airbnb
  // inbox via Smoobu or Channex), so the guest sees the reply where they
  // wrote. Channex bookings carry no guest email, so for those this is the
  // only way the reply reaches anyone.
  let channelRelay: string | null = null;
  let channelFailed = false;
  const relay = await relayMessageToChannel(
    { externalId: reservation.externalId, ownerId: session!.user!.id! },
    captionText,
    attachment
  );
  if (relay.status === "sent") {
    channelRelay = "sent";
  } else if (relay.status === "skipped") {
    channelRelay = "skipped";
    console.log(`[messages] relay skipped for reservation ${reservationId}: ${relay.reason}`);
  } else {
    console.error(`[messages] ${relay.provider} relay failed:`, relay.error);
    channelRelay = "failed";
    channelFailed = true;
    // Persist so the thread shows a "not delivered - retry" affordance
    await prisma.message.update({
      where: { id: message.id },
      data: { channelFailed: true, channelError: relay.error.slice(0, 300) },
    });
  }

  const attachmentSkipped = relay.status === "sent" && !!relay.attachmentSkipped;

  return NextResponse.json({ ...message, channelRelay, channelFailed, knowledgeSaved, attachmentSkipped }, { status: 201 });
}

// Mark messages as read
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reservationId } = await req.json();

  await prisma.message.updateMany({
    where: {
      reservationId,
      direction: "INBOUND",
      isRead: false,
      reservation: { property: { ownerId: session!.user!.id } },
    },
    data: { isRead: true },
  });

  return NextResponse.json({ success: true });
}
