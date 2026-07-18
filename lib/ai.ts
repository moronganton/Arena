import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendSmoobuGuestMessage } from "@/lib/channels/smoobu-core";
import { sendMessageToGuest } from "@/lib/notifications";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
- Keep replies friendly, professional, and concise
- If the guest asks about WiFi, parking, check-in/check-out, access codes, house rules, appliances or local tips — answer directly when the info is above
- Always greet the guest by name
- Sign off as "Your Host Team"
- Match the guest's language if possible`;

  const res = await client.messages.create({
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
  const res = await client.messages.create({
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

  if (!message || message.direction !== "INBOUND") return;

  const { reservation } = message;

  const aiSettings = await prisma.aiSettings.findFirst({
    where: { userId: reservation.property.ownerId, enabled: true },
  });
  if (!aiSettings) {
    console.log(`[ai] skipped message ${messageId}: AI assistant disabled`);
    return;
  }

  // Don't answer if an AI draft is already pending on this thread
  const pendingDraft = await prisma.message.findFirst({
    where: { reservationId: reservation.id, isDraft: true },
  });
  if (pendingDraft) {
    console.log(`[ai] skipped message ${messageId}: draft already pending`);
    return;
  }

  const knowledgeEntries = await prisma.propertyKnowledge.findMany({
    where: { propertyId: reservation.propertyId, active: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  const knowledge = knowledgeEntries
    .map((k) => `[${k.category}] ${k.title}: ${k.content}`)
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
  };

  const result = await generateAutoReply(
    message.body,
    context,
    aiSettings.customInstructions || undefined
  );

  console.log(
    `[ai] message ${messageId}: shouldReply=${result.shouldReply} confidence=${result.confidence}` +
    (result.reasoning ? ` — ${result.reasoning}` : "")
  );

  if (!result.shouldReply || result.confidence < aiSettings.confidenceThreshold) return;

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

  if (!isDraft) {
    await deliverAiMessage(reply.id);
  }
}
