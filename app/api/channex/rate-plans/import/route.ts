import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeExtraction } from "@/lib/rate-plan-import";
import { isAcceptableImageSrc } from "@/lib/image";

// Reads a Booking.com rate-plans screenshot and proposes a matching family.
//
// This does NOT create anything. It returns a proposal the operator confirms,
// edits, or throws away - because the cost of a confident mistake here is a
// property selling at the wrong price on two channels, and a screenshot is a
// lossy source. Creation happens afterwards through the existing provisioning
// endpoint, from whatever the operator actually approved.
//
// Same vision pattern lib/finance.ts already uses for invoice photos; the
// image arrives as a data URL already compressed on the device.
//
//   POST /api/channex/rate-plans/import   { propertyId, image }

// Thinking is deliberately not configured: on this model it runs adaptively
// when the parameter is omitted, and the installed SDK (0.39.0) predates the
// adaptive thinking type - passing the older budget_tokens form would be
// rejected outright.
const MODEL = "claude-opus-5";

const PROMPT = `This is a screenshot of the "Rate plans" page from a Booking.com extranet, for one short-term rental property.

Read every rate plan visible and return ONLY a JSON array (no markdown fence, no commentary):

[
  {
    "title": the rate plan's name exactly as written,
    "isStandard": true only for the plan the others are priced relative to (usually literally "Standard Rate", and its price column says something like "Managed by your Calendar" rather than a percentage),
    "percentOfStandard": for every OTHER plan, how its price relates to the standard one WHEN STATED AS A PERCENTAGE. Booking.com writes this as prose like "10% cheaper than Standard Rate" or "10% more expensive than Standard Rate" - return the number as negative when cheaper and positive when more expensive. null if the difference is a money amount rather than a percentage, or if none is shown,
    "amountOfStandard": the same relationship WHEN STATED AS A MONEY AMOUNT rather than a percentage - Booking.com writes "RON 10 more expensive than Standard Rate" or "EUR 12 cheaper than Standard Rate". Return just the number, negative when cheaper and positive when more expensive. null if the difference is a percentage or none is shown. Never fill both this and percentOfStandard for the same plan,
    "mealPlan": what the "Meal plan" column says for this plan - "Breakfast" when breakfast is included, "No meals" when it is not, or null if the column is not visible,
    "minStay": the minimum length of stay IF one is genuinely shown for that plan, otherwise null,
    "readMinStay": true ONLY if you actually saw a minimum stay value for that plan. Booking.com very often shows "No minimum length of stay" or says stay rules are managed on the calendar - in that case this MUST be false and minStay MUST be null. Do not infer a minimum from the plan's name,
    "cancellationPolicy": the cancellation policy text shown for that plan (e.g. "Flexible - 1 day", "Non-refundable"), or null
  }
]

Rules:
- Report only what is visible. Never invent a minimum stay, a percentage, or a plan.
- If a value is cut off or unreadable, use null rather than a guess.
- Ignore rows that are room types rather than rate plans.
- A price difference is either a percentage or a money amount, never both. Read whichever Booking.com actually shows.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Reading screenshots isn't configured on this server yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  const image = body?.image as string | undefined;
  if (!propertyId || !image) {
    return NextResponse.json({ error: "propertyId and image are required" }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // Same guard the property photo uses: an inline image, nothing else.
  if (!isAcceptableImageSrc(image) || !image.startsWith("data:")) {
    return NextResponse.json({ error: "Upload a JPEG, PNG or WebP screenshot" }, { status: 400 });
  }
  const match = image.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (!match) return NextResponse.json({ error: "Unsupported image format" }, { status: 400 });
  const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let text: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    // content is a discriminated union - narrow rather than index blindly,
    // and thinking blocks may precede the answer.
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    // Most specific first: a bad key and a rate limit need different answers.
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The reading service rejected this server's credentials." }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Too many screenshots at once - try again in a moment." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Couldn't read the screenshot (${err.status}).` }, { status: 502 });
    }
    return NextResponse.json({ error: "Couldn't read the screenshot." }, { status: 502 });
  }

  // The model was asked for bare JSON, but a stray fence should not lose the
  // operator their upload.
  const jsonText = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return NextResponse.json(
      { error: "That screenshot couldn't be read as a rate plan list. Try a clearer capture of the whole table." },
      { status: 422 }
    );
  }

  // Everything that decides whether this is usable is pure and tested.
  return NextResponse.json(normalizeExtraction(parsed));
}
