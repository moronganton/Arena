import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

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

${customInstructions ? `Host instructions: ${customInstructions}` : ""}

You must respond in JSON with this exact structure:
{
  "shouldReply": boolean,
  "confidence": number (0-1),
  "message": "your response to the guest",
  "reasoning": "why you chose this reply"
}

Guidelines:
- Only reply if you can answer with HIGH confidence (>0.8) from the context provided
- For complex issues (maintenance, refunds, disputes), set shouldReply=false so the host reviews manually
- Keep replies friendly, professional, and concise
- If the guest asks about WiFi password, parking, check-in time, check-out time, access codes — answer directly if you have the info
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

  const aiSettings = await prisma.aiSettings.findFirst({
    where: { enabled: true, autoReplyEnabled: true },
  });

  if (!aiSettings) return;

  const { reservation } = message;
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
  };

  const result = await generateAutoReply(
    message.body,
    context,
    aiSettings.customInstructions || undefined
  );

  if (result.shouldReply && result.confidence >= aiSettings.confidenceThreshold) {
    await prisma.message.create({
      data: {
        body: result.message,
        direction: "OUTBOUND",
        channel: message.channel,
        source: message.source,
        isAiGenerated: true,
        reservationId: message.reservationId,
      },
    });
  }
}
