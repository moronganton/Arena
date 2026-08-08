import { getClient } from "@/lib/ai";

const MODEL = "claude-haiku-4-5-20251001";

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  const block = res.content[0];
  return block?.type === "text" ? (block.text ?? "").trim() : "";
}

// Single-word answer: the message's language, in English ("French", "Slovak"),
// or literally "English". Run once per message and cached on Message.detectedLanguage
// — this decides whether the translate pill shows at all, so it needs to be
// cheap and needs to run before the host ever taps anything.
export async function detectLanguage(text: string): Promise<string> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 12,
    messages: [{ role: "user", content: text.slice(0, 500) }],
    system:
      "Identify the language of this message. Reply with ONLY the language's " +
      'English name (e.g. "French", "Slovak", "English"), nothing else. If the ' +
      'message is too short or ambiguous to tell (an emoji, a single "ok"), ' +
      'reply "English".',
  });
  const name = textOf(res).replace(/[.\s]+$/, "");
  return name || "English";
}

// Translates one guest message to English. Called only when the host taps the
// pill, and only ever once per message — the result is cached on
// Message.translatedBody by the caller.
export async function translateToEnglish(text: string): Promise<string> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: text }],
    system:
      "Translate the guest's message to English. Reply with ONLY the " +
      "translation — no preamble, no quotes, no explanation. Keep the tone " +
      "and register of the original (casual stays casual).",
  });
  return textOf(res) || text;
}

// Translates a HOST-authored template into another language, for the
// "Duplicate & translate" action on the Templates page. Different job from
// translateToEnglish: this text contains StayHQ's own merge-field tokens
// (e.g. "[Full Name]", "[Access Code]") which must survive completely
// unchanged — mistranslating or dropping one would silently break every
// message sent from the duplicate.
export async function translateTemplateText(text: string, targetLanguage: string): Promise<string> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: text }],
    system:
      `Translate this message template into ${targetLanguage}. Reply with ONLY ` +
      "the translation — no preamble, no quotes, no explanation.\n\n" +
      "The text contains merge-field tokens in square brackets, e.g. [Full Name], " +
      "[Property Name], [Check-in Date], [Access Code]. Copy every bracketed " +
      "token EXACTLY as it appears, character for character, in the same " +
      "position — never translate, reorder, or alter the text inside brackets. " +
      "Translate only the surrounding sentence.\n\n" +
      "Keep the tone, line breaks, and any emoji.",
  });
  return textOf(res) || text;
}
