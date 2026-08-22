import { channexPost, channexBaseUrl } from "./channex-core";

// Channex's Messages API attachment mechanism, confirmed against the real
// docs (docs.channex.io/api-v.1-documentation/messages-collection):
//
//   1. POST /attachments with the file base64-encoded -> returns an
//      attachment id
//   2. POST /bookings/:id/messages with { attachment_id } (optionally
//      alongside message text) references it
//
// Inbound attachments come back as paths RELATIVE to the API base, not full
// URLs - the docs say to prepend the environment's API root.
//
// Smoobu has no equivalent at all (confirmed against their API - the whole
// reason this file exists rather than a shared attachments module).

// Generous for a phone photo, cheap enough to store as a base64 data URL in
// Postgres directly - same convention as CleaningTask.photos, no separate
// file-storage service. Enforced both on upload (host-sent) and on download
// (guest-sent), so neither direction can silently write an oversized row.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Uploads a data: URL (as produced by a browser FileReader) to Channex and
// returns the attachment id to reference when sending the message.
export async function uploadChannexAttachment(dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Attachment is not a valid data URL");

  // Base64 is ~4/3 the size of the raw bytes - approximate rather than
  // decode just to measure, since decoding a rejected oversized file is
  // wasted work.
  const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
  if (approxBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is too large (${(approxBytes / 1024 / 1024).toFixed(1)}MB, max 5MB)`);
  }

  const ext = EXTENSION_BY_MIME[parsed.mime] ?? "bin";
  const res = await channexPost<{ id?: string }>("/attachments", {
    attachment: { file: parsed.base64, file_name: `attachment.${ext}`, file_type: parsed.mime },
  });
  const id = res.data?.id;
  if (!id) throw new Error("Channex did not return an attachment id");
  return id;
}

function resolveChannexAttachmentUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path; // already absolute - not the documented shape, but safe if it changes
  return `${channexBaseUrl()}/${path.replace(/^\/+/, "")}`;
}

// Downloads one inbound (guest-sent) attachment and re-encodes it as a data
// URL, so it lives in our own database the same way outbound ones do - no
// dependency on Channex's URL staying reachable, or on holding the API key
// available at render time to fetch it on demand.
export async function fetchChannexAttachmentAsDataUrl(relativeOrAbsolutePath: string): Promise<string> {
  const key = process.env.CHANNEX_API_KEY;
  if (!key) throw new Error("CHANNEX_API_KEY is not set");
  const url = resolveChannexAttachmentUrl(relativeOrAbsolutePath);

  const res = await fetch(url, { headers: { "user-api-key": key } });
  if (!res.ok) throw new Error(`Failed to fetch attachment (HTTP ${res.status}): ${url}`);

  const contentType = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Inbound attachment too large to store (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
  }
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}
