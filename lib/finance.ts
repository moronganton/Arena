import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const EXPENSE_CATEGORIES = [
  "CLEANING",
  "LAUNDRY",
  "PLATFORM_FEES",
  "ESSENTIALS",
  "DAMAGES",
  "INSURANCE",
  "UTILITIES",
  "MAINTENANCE",
  "OTHER",
] as const;

export interface ExtractedInvoice {
  category: string;
  description: string;
  amount: number | null;
  currency: string | null;
  date: string | null; // YYYY-MM-DD
  propertyName: string | null;
  confidence: number;
}

// Extract expense data from an invoice photo using Claude vision
export async function extractInvoiceData(
  imageDataUrl: string,
  propertyNames: string[]
): Promise<ExtractedInvoice> {
  // Split "data:image/jpeg;base64,...." into media type + data
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (!match) throw new Error("Invalid image format — please upload a JPEG or PNG photo");
  const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  const base64 = match[2];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `This is an invoice or receipt for a short-term rental property business.
Extract the expense information and respond with ONLY a JSON object (no markdown, no explanation):

{
  "category": one of ${JSON.stringify(EXPENSE_CATEGORIES)} — classify what this cost is for:
    CLEANING (cleaning services), LAUNDRY (washing/linen services), PLATFORM_FEES (Booking.com/Airbnb commissions),
    ESSENTIALS (supplies: toilet paper, coffee, soap, consumables), DAMAGES (repairs/replacements of broken items),
    INSURANCE, UTILITIES (electricity/water/gas/internet), MAINTENANCE (regular upkeep, HVAC service), OTHER,
  "description": short human summary of what was purchased/paid (max 80 chars),
  "amount": total amount as a number (the final total including tax),
  "currency": 3-letter code (EUR, RON, CZK, USD...) or null if unclear,
  "date": invoice date as YYYY-MM-DD or null if unclear,
  "propertyName": ${
    propertyNames.length > 0
      ? `if the invoice mentions an address or property matching one of these, return the EXACT matching name from this list, else null: ${JSON.stringify(propertyNames)}`
      : "null"
  },
  "confidence": 0-1 how confident you are in the extraction
}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  // Tolerate accidental markdown fences
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(jsonText);
    return {
      category: EXPENSE_CATEGORIES.includes(parsed.category) ? parsed.category : "OTHER",
      description: String(parsed.description || "Invoice"),
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      currency: parsed.currency || null,
      date: parsed.date || null,
      propertyName: parsed.propertyName || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    throw new Error("Could not read the invoice — try a clearer photo");
  }
}
