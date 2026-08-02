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

// Booking.com/Airbnb chat, reached through Smoobu's send-message-to-guest
// endpoint, accepts a plain `messageBody` string and nothing else — there is no
// attachment parameter anywhere in that path. So the only way a photo reaches
// an OTA guest is as a link they can tap. Append one public URL per image.
export function appendImageLinks(body: string, images: OutboundImage[], baseUrl: string | null): string {
  if (images.length === 0 || !baseUrl) return body;
  const links = images.map((img) => `${baseUrl}/api/templates/images/${img.id}/raw`);
  const heading = images.length === 1 ? "Photo:" : "Photos:";
  return `${body}\n\n${heading}\n${links.join("\n")}`;
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
