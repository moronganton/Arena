import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { smoobuProvider } from "@/lib/channels/smoobu-provider";
import { sendMessageToGuest } from "@/lib/notifications";
import { recordAiSuccess, recordAiFailure, readRateLimitHeaders } from "@/lib/ai-health";
import { notifyUser } from "@/lib/notify";
import { cetDayStartUtc } from "@/lib/cet";

// Lazy init: a missing ANTHROPIC_API_KEY must never crash module import
// (which would take down message sync and webhooks with it).
//
// Note: this is the Anthropic *API* (billed per-token via the console API key),
// which is entirely separate from any Claude Pro / claude.ai subscription —
// Pro usage limits have no effect here. maxRetries makes transient API rate
// limits (429) self-heal with exponential backoff, honoring Retry-After.
let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
  return _client;
}

interface ReservationContext {
  guestName: string;
  propertyName: string;
  propertyAddress: string;
  checkIn: Date;
  checkOut: Date;
  confirmationCode?: string | null;
  accessCode?: string;
  specialRequests?: string | null;
  knowledge?: string;
  recentConversation?: string;
}

interface AutoReplyResult {
  shouldReply: boolean;
  confidence: number;
  message: string;
  reasoning?: string;
}

// Unambiguous calendar date. checkIn/checkOut hold calendar dates pinned to UTC
// midnight (see cetDayStartUtc), so they format in UTC; "8/16/2026" from a bare
// toLocaleDateString() is both locale-dependent and ambiguous to the model.
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric",
});
const NOW_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short",
  year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

// Where the stay sits relative to right now, stated outright for the prompt.
//
// The model has no inherent sense of "today", and without being told it assumed
// every stay was still upcoming - it told a guest already on night 2 "looking
// forward to your arrival on the 16th". The phase is computed here rather than
// left to the model to infer from two dates, because date arithmetic is exactly
// what a small fast model gets wrong, and stating the answer costs nothing.
//
// Days are compared as CET calendar days (Europe/Berlin), matching how lock
// validity already works app-wide. Note for later: this assumes a CET portfolio.
// A property genuinely in another timezone needs Property.timezone threaded
// through here - it currently defaults to "UTC" and is not maintained.
export function describeStayTiming(checkIn: Date, checkOut: Date, now: Date = new Date()): string {
  const DAY = 86400000;
  const today = cetDayStartUtc(now).getTime();
  const arrive = cetDayStartUtc(checkIn).getTime();
  const depart = cetDayStartUtc(checkOut).getTime();
  const nights = Math.max(1, Math.round((depart - arrive) / DAY));
  const plural = (n: number) => (n === 1 ? "day" : "days");

  if (today < arrive) {
    const away = Math.round((arrive - today) / DAY);
    return away === 1
      ? "Guest arrives TOMORROW. The stay has not started - they are not at the property yet."
      : `Guest arrives in ${away} ${plural(away)}. The stay has not started - they are not at the property yet.`;
  }
  if (today === arrive) {
    return "Guest ARRIVES TODAY. They may be travelling or already checking in - do not talk about arrival as if it were days away.";
  }
  if (today < depart) {
    const night = Math.round((today - arrive) / DAY) + 1;
    const left = Math.round((depart - today) / DAY);
    return `Guest is CURRENTLY STAYING AT THE PROPERTY - night ${night} of ${nights}, checking out in ${left} ${plural(left)}. Their arrival already happened; never refer to it as upcoming.`;
  }
  if (today === depart) {
    return "Guest CHECKS OUT TODAY. Their stay is ending - never refer to their arrival as upcoming.";
  }
  const ago = Math.round((today - depart) / DAY);
  return `Stay ALREADY ENDED ${ago} ${plural(ago)} ago - the guest has checked out and left. Never refer to their arrival or stay as upcoming.`;
}

export async function generateAutoReply(
  incomingMessage: string,
  context: ReservationContext,
  customInstructions?: string,
  // When set, the call's rate-limit headroom is recorded against this owner so
  // the AI Status panel can show how much room is left before the next limit.
  ownerId?: string
): Promise<AutoReplyResult> {
  const systemPrompt = `You are a helpful property management assistant responding on behalf of a short-term rental host.

RIGHT NOW IT IS: ${NOW_FMT.format(new Date())} (property local time)

Property: ${context.propertyName}
Address: ${context.propertyAddress}
Guest: ${context.guestName}
Check-in: ${DATE_FMT.format(context.checkIn)}
Check-out: ${DATE_FMT.format(context.checkOut)}
STAY STATUS: ${describeStayTiming(context.checkIn, context.checkOut)}
${context.confirmationCode ? `Confirmation: ${context.confirmationCode}` : ""}
${context.accessCode ? `Access Code: ${context.accessCode}` : ""}
${context.specialRequests ? `Guest requests: ${context.specialRequests}` : ""}

${context.knowledge ? `PROPERTY KNOWLEDGE BASE (your primary source of truth — answer ONLY from these facts):\n${context.knowledge}` : "No knowledge base entries exist for this property."}

${context.recentConversation ? `RECENT CONVERSATION (for tone and context — don't repeat what was already said):\n${context.recentConversation}` : ""}

${customInstructions ? `Host instructions: ${customInstructions}` : ""}

You must respond in JSON with this exact structure:
{
  "shouldReply": boolean,
  "confidence": number (0-1),
  "message": "your response to the guest",
  "reasoning": "why you chose this reply"
}

Guidelines:
- Only reply if the answer is clearly present in the knowledge base or reservation details above — never invent facts (no made-up codes, prices, times or addresses)
- If the knowledge base does not contain the answer, set shouldReply=false so the host replies manually
- For complex issues (maintenance, damages, refunds, disputes, date changes), set shouldReply=false
- If the guest asks about WiFi, parking, check-in/check-out, access codes, house rules, appliances or local tips — answer directly when the info is above

Timing — get the tense right, this is highly visible when wrong:
- Read STAY STATUS above before writing anything about dates. It is authoritative; do not work the timing out yourself from the check-in date.
- If the guest is already at the property or has checked out, NEVER say you look forward to their arrival, and never refer to check-in as something still to come.
- Prefer not mentioning dates at all unless the guest asked about them. "Thanks, got it!" is better than a sentence that risks the wrong tense.

Writing style — you are the host personally texting in a messaging app, NOT a support bot:
- Just answer the question directly, the way a person replies in a chat. Do NOT open with "Hi <name>", "Hello", "Dear guest" etc. — in an ongoing conversation nobody greets on every message. A greeting is only natural in the very first message of the whole conversation.
- NO sign-offs: never end with "Your Host Team", "Best regards", your name, or any signature. Chat messages don't have signatures.
- Skip corporate filler: no "Thank you for your inquiry", "Great question!", "Please don't hesitate to reach out", "We're happy to assist".
- Keep it short and natural — 1-4 sentences is usually enough. A casual "Sure!" or "Of course" is fine.
- Vary your phrasing; don't follow a template.
- Match the guest's language and mirror their tone (casual if they're casual).`;

  // .withResponse() also hands back the raw HTTP response, so we can read the
  // rate-limit headroom headers Anthropic returns on every call.
  const { data: res, response } = await getClient()
    .messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Guest message: "${incomingMessage}"\n\nGenerate an appropriate reply.`,
        },
      ],
      system: systemPrompt,
    })
    .withResponse();

  if (ownerId) {
    await recordAiSuccess(ownerId, readRateLimitHeaders(response.headers));
  }

  const text = res.content[0].type === "text" ? res.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {
      shouldReply: false,
      confidence: 0,
      message: "",
      reasoning: "Failed to parse AI response",
    };
  }
}

export async function classifyMessageIntent(message: string): Promise<string> {
  const res = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    messages: [{ role: "user", content: message }],
    system: `Classify this guest message into one of these categories (respond with ONLY the category name):
CHECK_IN_INFO, CHECK_OUT_INFO, ACCESS_CODE, WIFI, PARKING, AMENITIES, COMPLAINT, REFUND, CANCELLATION, GENERAL_INQUIRY, MAINTENANCE`,
  });

  return res.content[0].type === "text" ? res.content[0].text.trim() : "GENERAL_INQUIRY";
}

// Deliver an AI (or approved draft) message to the guest: relay via the
// booking channel when possible, and email if the guest has an address.
// Returns false if the channel relay failed (so callers can skip a redundant
// "replied" notification — deliverAiMessage already sent a delivery_failed one).
export async function deliverAiMessage(messageId: string): Promise<boolean> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { reservation: { include: { guest: true, property: true } } },
  });
  if (!message) return false;
  const { reservation } = message;
  let channelOk = true;

  if (reservation.externalId?.startsWith("smoobu-")) {
    try {
      await smoobuProvider.sendGuestMessage(reservation.property.ownerId, reservation.externalId, message.body);
      // Clear a prior failure flag if this (re)send finally got through
      if (message.channelFailed) {
        await prisma.message.update({ where: { id: message.id }, data: { channelFailed: false, channelError: null } });
      }
    } catch (err) {
      channelOk = false;
      console.error("[ai] channel relay failed:", err);
      // Surface it: the message looks sent in StayHQ but never reached the guest
      await prisma.message.update({
        where: { id: message.id },
        data: { channelFailed: true, channelError: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
      });
      await notifyUser(reservation.property.ownerId, {
        type: "delivery_failed",
        title: "Reply didn't reach the guest",
        body: `Your AI reply to ${reservation.guest.name} (${reservation.property.name}) failed to send. Open the thread to retry.`,
        link: `/messages?reservationId=${reservation.id}`,
      });
    }
  }
  if (reservation.guest.email) {
    try {
      await sendMessageToGuest({
        guestName: reservation.guest.name,
        guestEmail: reservation.guest.email,
        propertyName: reservation.property.name,
        messageBody: message.body,
        reservationId: reservation.id,
      });
    } catch (err) {
      console.error("[ai] email delivery failed:", err);
    }
  }
  return channelOk;
}

// Process one inbound guest message.
export async function processIncomingMessage(messageId: string): Promise<void> {
  await processIncomingMessages([messageId]);
}

// Process a batch of inbound guest messages (same reservation) as ONE turn:
// - AI disabled → do nothing
// - AI enabled, auto-reply OFF (testing) → create a DRAFT for host approval
// - AI enabled, auto-reply ON → send the reply automatically
//
// Batching matters beyond convenience: Airbnb/Booking.com (via Smoobu) accept
// a single reply per burst fine, but appear to silently suppress the guest
// ever seeing it when a host integration fires several separate replies back
// to back — even when each individual send succeeds against Smoobu's API with
// no error. A guest asking 6 questions in 6 separate messages must produce ONE
// combined reply and ONE relay send, the same as if they'd asked all 6 in a
// single message (which already worked) — not 6 sends we can't get delivered.
//
// Wrapped so any unexpected failure (not just the AI-call failure already
// handled inside) can never silently drop a guest message: callers that loop
// over several new messages (on-demand sync, webhook sync) must not have one
// bad batch abort the rest, and the host must always end up notified.
export async function processIncomingMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  try {
    await processIncomingMessagesImpl(messageIds);
  } catch (err) {
    console.error(`[ai] messages ${messageIds.join(",")}: unexpected failure in processIncomingMessages:`, err);
    try {
      await prisma.message.updateMany({
        where: { id: { in: messageIds } },
        data: { needsHostReply: true },
      });
      const sample = await prisma.message.findUnique({
        where: { id: messageIds[0] },
        include: { reservation: { include: { property: true, guest: true } } },
      });
      if (sample) {
        await notifyUser(sample.reservation.property.ownerId, {
          type: "guest_reply",
          title:
            messageIds.length > 1
              ? `${sample.reservation.guest.name} sent ${messageIds.length} messages — needs a reply`
              : `${sample.reservation.guest.name} needs a reply`,
          body: sample.body.replace(/\s+/g, " ").trim().slice(0, 140),
          link: `/messages?reservationId=${sample.reservation.id}`,
        });
      }
    } catch (fallbackErr) {
      console.error(`[ai] messages ${messageIds.join(",")}: fallback notify also failed:`, fallbackErr);
    }
  }
}

async function processIncomingMessagesImpl(messageIds: string[]): Promise<void> {
  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, direction: "INBOUND" },
    include: {
      reservation: {
        include: {
          property: true,
          guest: true,
          accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (messages.length === 0) {
    console.log(`[ai] skipped messageIds ${messageIds.join(",")}: none inbound or found`);
    return;
  }
  const reservation = messages[0].reservation;
  console.log(`[ai] processing ${messages.length} inbound message(s): ${messageIds.join(",")}`);

  const aiSettings = await prisma.aiSettings.findFirst({
    where: { userId: reservation.property.ownerId, enabled: true },
  });
  if (!aiSettings) {
    console.log(`[ai] skipped messages ${messageIds.join(",")}: AI assistant disabled`);
    return;
  }
  if (!reservation.property.aiEnabled) {
    console.log(`[ai] skipped messages ${messageIds.join(",")}: AI assistant disabled for property "${reservation.property.name}"`);
    return;
  }

  const knowledgeEntries = await prisma.propertyKnowledge.findMany({
    where: { propertyId: reservation.propertyId, active: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  const knowledge = knowledgeEntries
    .map((k) => `[${k.category}] ${k.title}: ${k.content}`)
    .join("\n");

  // Last few exchanged messages, so the reply fits the flow of the
  // conversation (no greeting mid-thread, no repeating earlier answers)
  const recentMessages = await prisma.message.findMany({
    where: {
      reservationId: reservation.id,
      isDraft: false,
      channel: { not: "INTERNAL" }, // private host notes must never reach the AI/guest
      id: { notIn: messageIds },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const recentConversation = recentMessages
    .reverse()
    .map((m) => `${m.direction === "INBOUND" ? "Guest" : "Host"}: ${m.body.slice(0, 300)}`)
    .join("\n");

  // Multiple new messages become ONE guest turn — same shape as a guest
  // asking several questions in a single message, which already works.
  const combinedGuestText =
    messages.length === 1
      ? messages[0].body
      : messages.map((m, i) => `${i + 1}. ${m.body}`).join("\n");

  const latestCode = reservation.accessCodes[0];
  const context: ReservationContext = {
    guestName: reservation.guest.name,
    propertyName: reservation.property.name,
    propertyAddress: reservation.property.address,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    confirmationCode: reservation.confirmationCode,
    accessCode: latestCode?.code,
    specialRequests: reservation.specialRequests,
    knowledge: knowledge || undefined,
    recentConversation: recentConversation || undefined,
  };

  let result: AutoReplyResult;
  try {
    result = await generateAutoReply(
      combinedGuestText,
      context,
      aiSettings.customInstructions || undefined,
      reservation.property.ownerId
    );
  } catch (err) {
    // AI unavailable — flag the messages for the host so they aren't left unanswered.
    // recordAiFailure classifies the cause (these are the Anthropic API's OWN
    // limits — rate limit, exhausted credits, spend cap, or a bad key — NOT the
    // Claude Pro subscription), stores it for the AI Status panel, and emails the
    // owner if it's an actionable outage (debounced to once per 30 min).
    const info = await recordAiFailure(reservation.property.ownerId, err);
    console.error(
      `[ai] messages ${messageIds.join(",")}: generation failed — type=${info.type} status=${info.status ?? "?"} — ${info.title}: ${info.hint}`
    );
    await prisma.message.updateMany({ where: { id: { in: messageIds } }, data: { needsHostReply: true } });
    return;
  }

  console.log(
    `[ai] messages ${messageIds.join(",")}: shouldReply=${result.shouldReply} confidence=${result.confidence}` +
    (result.reasoning ? ` — ${result.reasoning}` : "")
  );

  const guestPreview = combinedGuestText.replace(/\s+/g, " ").trim().slice(0, 140);

  if (!result.shouldReply || result.confidence < aiSettings.confidenceThreshold) {
    console.log(
      `[ai] messages ${messageIds.join(",")}: not replying (shouldReply=${result.shouldReply}, ` +
      `confidence=${result.confidence} vs threshold=${aiSettings.confidenceThreshold})`
    );
    // The AI is standing down — highlight the messages so the host replies
    await prisma.message.updateMany({ where: { id: { in: messageIds } }, data: { needsHostReply: true } });
    await notifyUser(reservation.property.ownerId, {
      type: "guest_reply",
      title:
        messages.length > 1
          ? `${reservation.guest.name} sent ${messages.length} messages — needs a reply`
          : `${reservation.guest.name} needs a reply`,
      body: guestPreview,
      link: `/messages?reservationId=${reservation.id}`,
    });
    return;
  }

  const isDraft = !aiSettings.autoReplyEnabled;
  const reply = await prisma.message.create({
    data: {
      body: result.message,
      direction: "OUTBOUND",
      channel: "PLATFORM",
      isAiGenerated: true,
      isDraft,
      isRead: true,
      reservationId: reservation.id,
    },
  });
  console.log(`[ai] messages ${messageIds.join(",")}: ${isDraft ? "draft" : "auto-reply"} ${reply.id} created`);
  // Clear the flag on every batched message this reply answers (e.g. reprocessed after a repair)
  await prisma.message.updateMany({
    where: { id: { in: messageIds }, needsHostReply: true },
    data: { needsHostReply: false },
  });

  if (isDraft) {
    // Auto-reply is off — the AI wrote a draft, but a human still has to send it
    await notifyUser(reservation.property.ownerId, {
      type: "guest_reply",
      title:
        messages.length > 1
          ? `${reservation.guest.name} sent ${messages.length} messages — AI drafted a reply`
          : `${reservation.guest.name} messaged you — AI drafted a reply`,
      body: guestPreview,
      link: `/messages?reservationId=${reservation.id}`,
    });
  } else {
    const delivered = await deliverAiMessage(reply.id);
    // Only notify on success — a failed relay already sent its own
    // delivery_failed alert inside deliverAiMessage, so this would double up.
    if (delivered) {
      await notifyUser(reservation.property.ownerId, {
        type: "info",
        title:
          messages.length > 1
            ? `${reservation.guest.name} sent ${messages.length} messages — AI replied automatically`
            : `${reservation.guest.name} messaged you — AI replied automatically`,
        body: guestPreview,
        link: `/messages?reservationId=${reservation.id}`,
      });
    }
  }
}
