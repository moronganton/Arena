import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendSmoobuGuestMessage } from "@/lib/channels/smoobu-core";
import { sendMessageToGuest } from "@/lib/notifications";

// Lazy init: a missing ANTHROPIC_API_KEY must never crash module import
// (which would take down message sync and webhooks with it).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

export async function generateAutoReply(
  incomingMessage: string,
  context: ReservationContext,
  customInstructions?: string
): Promise<AutoReplyResult> {
  const systemPrompt = `You are a helpful property management assistant responding on behalf of a short-term rental host.

Property: ${context.propertyName}
Address: ${context.propertyAddress}
Guest: ${context.guestName}
Check-in: ${context.checkIn.toLocaleDateString()}
Check-out: ${context.checkOut.toLocaleDateString()}
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

Writing style — you are the host personally texting in a messaging app, NOT a support bot:
- Just answer the question directly, the way a person replies in a chat. Do NOT open with "Hi <name>", "Hello", "Dear guest" etc. — in an ongoing conversation nobody greets on every message. A greeting is only natural in the very first message of the whole conversation.
- NO sign-offs: never end with "Your Host Team", "Best regards", your name, or any signature. Chat messages don't have signatures.
- Skip corporate filler: no "Thank you for your inquiry", "Great question!", "Please don't hesitate to reach out", "We're happy to assist".
- Keep it short and natural — 1-4 sentences is usually enough. A casual "Sure!" or "Of course" is fine.
- Vary your phrasing; don't follow a template.
- Match the guest's language and mirror their tone (casual if they're casual).`;

  const res = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Guest message: "${incomingMessage}"\n\nGenerate an appropriate reply.`,
      },
    ],
    system: systemPrompt,
  });

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
export async function deliverAiMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { reservation: { include: { guest: true, property: true } } },
  });
  if (!message) return;
  const { reservation } = message;

  if (reservation.externalId?.startsWith("smoobu-")) {
    try {
      await sendSmoobuGuestMessage(reservation.property.ownerId, reservation.externalId, message.body);
    } catch (err) {
      console.error("[ai] channel relay failed:", err);
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
}

// Process an inbound guest message:
// - AI disabled → do nothing
// - AI enabled, auto-reply OFF (testing) → create a DRAFT for host approval
// - AI enabled, auto-reply ON → send the reply automatically
export async function processIncomingMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      reservation: {
        include: {
          property: true,
          guest: true,
          accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!message || message.direction !== "INBOUND") {
    console.log(`[ai] skipped messageId ${messageId}: not inbound or not found`);
    return;
  }
  console.log(`[ai] processing inbound message ${messageId}`);

  const { reservation } = message;

  const aiSettings = await prisma.aiSettings.findFirst({
    where: { userId: reservation.property.ownerId, enabled: true },
  });
  if (!aiSettings) {
    console.log(`[ai] skipped message ${messageId}: AI assistant disabled`);
    return;
  }

  // Allow multiple AI drafts per reservation; they can be approved/discarded independently
  // No need to check for pending drafts — just generate a response to this message

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
      id: { not: message.id },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const recentConversation = recentMessages
    .reverse()
    .map((m) => `${m.direction === "INBOUND" ? "Guest" : "Host"}: ${m.body.slice(0, 300)}`)
    .join("\n");

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
      message.body,
      context,
      aiSettings.customInstructions || undefined
    );
  } catch (err) {
    // AI unavailable (API error, missing key...) — flag for the host
    console.error(`[ai] message ${messageId}: generation failed:`, err);
    await prisma.message.update({ where: { id: messageId }, data: { needsHostReply: true } });
    return;
  }

  console.log(
    `[ai] message ${messageId}: shouldReply=${result.shouldReply} confidence=${result.confidence}` +
    (result.reasoning ? ` — ${result.reasoning}` : "")
  );

  if (!result.shouldReply || result.confidence < aiSettings.confidenceThreshold) {
    console.log(
      `[ai] message ${messageId}: not replying (shouldReply=${result.shouldReply}, ` +
      `confidence=${result.confidence} vs threshold=${aiSettings.confidenceThreshold})`
    );
    // The AI is standing down — highlight the message so the host replies
    await prisma.message.update({ where: { id: messageId }, data: { needsHostReply: true } });
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
      reservationId: message.reservationId,
    },
  });
  console.log(`[ai] message ${messageId}: ${isDraft ? "draft" : "auto-reply"} ${reply.id} created`);
  if (message.needsHostReply) {
    // Answered after all (e.g. reprocessed after a repair) — clear the flag
    await prisma.message.update({ where: { id: messageId }, data: { needsHostReply: false } });
  }

  if (!isDraft) {
    await deliverAiMessage(reply.id);
  }
}
