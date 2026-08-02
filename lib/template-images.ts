import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export interface OutboundImage {
  id: string;
  fileName: string;
  mimeType: string;
  url: string; // stored as a data: URL (base64) by /api/templates/upload-image
}

// Resend caps a single email at ~40MB. Stay well under it — a template with a
// handful of 5MB photos would otherwise silently fail to send at all.
const MAX_EMAIL_ATTACH_BYTES = 15 * 1024 * 1024;

// The public origin guests must be able to reach. Behind Railway's proxy the
// request URL is the internal address, so NEXTAUTH_URL is the reliable source
// (same reasoning as /api/webhook-url). Returns null when it isn't usable, in
// which case we must not put a localhost link in a real guest message.
export function publicBaseUrl(): string | null {
  const configured = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (configured && !configured.includes("localhost")) return configured;
  return null;
}

export async function getTemplateImages(templateId: string | null | undefined): Promise<OutboundImage[]> {
  if (!templateId) return [];
  return prisma.templateImage.findMany({
    where: { templateId },
    orderBy: { order: "asc" },
    select: { id: true, fileName: true, mimeType: true, url: true },
  });
}

// Unambiguous alphabet — no 0/o/1/l/i, so a guest reading the link aloud or
// retyping it from a screenshot cannot land on the wrong page.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function makeCode(len = 8): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// Guests get ONE short link to a photo page rather than a wall of raw image
// URLs. Generated on first use so existing templates need no backfill.
export async function ensureShareCode(templateId: string): Promise<string | null> {
  const existing = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    select: { shareCode: true },
  });
  if (!existing) return null;
  if (existing.shareCode) return existing.shareCode;

  // Retry on the (vanishingly rare) collision against the unique index.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    try {
      await prisma.messageTemplate.update({ where: { id: templateId }, data: { shareCode: code } });
      return code;
    } catch {
      const raced = await prisma.messageTemplate.findUnique({
        where: { id: templateId },
        select: { shareCode: true },
      });
      if (raced?.shareCode) return raced.shareCode; // a concurrent send won
    }
  }
  return null;
}

// Booking.com/Airbnb chat, reached through Smoobu's send-message-to-guest
// endpoint, accepts a plain `messageBody` string and nothing else — no HTML, no
// markdown, no attachment parameter. A photo cannot be embedded in the chat
// bubble itself, so the best available form is a single tidy link to a page
// that shows them all.
export function appendGalleryLink(body: string, images: OutboundImage[], baseUrl: string | null, shareCode: string | null): string {
  if (images.length === 0 || !baseUrl || !shareCode) return body;
  const label = images.length === 1 ? "Photo" : `Photos (${images.length})`;
  return `${body}\n\n${label}: ${baseUrl}/g/${shareCode}`;
}

// Email is the one channel that can carry the real files, so guests with an
// email address get proper attachments rather than only the links.
export function toEmailAttachments(images: OutboundImage[]): { filename: string; content: string }[] {
  const out: { filename: string; content: string }[] = [];
  let total = 0;
  for (const img of images) {
    const comma = img.url.indexOf(",");
    if (!img.url.startsWith("data:") || comma === -1) continue;
    const base64 = img.url.slice(comma + 1);
    total += Math.floor((base64.length * 3) / 4);
    if (total > MAX_EMAIL_ATTACH_BYTES) break;
    out.push({ filename: img.fileName, content: base64 });
  }
  return out;
}
