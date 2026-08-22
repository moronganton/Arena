import { channexGet, channexPost, channexDelete, channexBaseUrl } from "./channex-core";

// Confirmed against the real docs: Photos are a standalone collection
// (property_id + optional room_type_id, one create call per photo, no batch
// endpoint needed for a simple gallery manager). Upload is a separate step -
// POST a multipart file to /photos/upload, get back a temporary hosted URL,
// then Create Photo with that URL. The temporary URL is only good until it's
// referenced in a Create call, per Channex's own wording.

export interface ChannexPhoto {
  id: string;
  url: string;
  property_id: string;
  room_type_id: string | null;
  kind: "photo" | "ad" | "menu";
  position: number;
  author: string | null;
  description: string | null;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // generous for a real listing photo, still bounded

// Multipart upload - the one Channex call that isn't a plain JSON POST, so it
// bypasses channexPost and builds the request directly, the same way
// channex-attachments.ts's binary fetch does for the same reason.
export async function uploadChannexPhoto(dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Photo is not a valid data URL");
  if (parsed.buffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo is too large (${(parsed.buffer.byteLength / 1024 / 1024).toFixed(1)}MB, max 8MB)`);
  }

  const key = process.env.CHANNEX_API_KEY;
  if (!key) throw new Error("CHANNEX_API_KEY is not set");

  const ext = EXTENSION_BY_MIME[parsed.mime] ?? "jpg";
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), `photo.${ext}`);

  const res = await fetch(`${channexBaseUrl()}/photos/upload`, {
    method: "POST",
    headers: { "user-api-key": key },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Photo upload failed (HTTP ${res.status}): ${text.slice(0, 300)}`);

  const parsedBody = JSON.parse(text) as { url?: string };
  if (!parsedBody.url) throw new Error("Channex did not return a temporary photo URL");
  return parsedBody.url;
}

export async function listPropertyPhotos(channexPropertyId: string): Promise<ChannexPhoto[]> {
  const res = await channexGet<Array<{ id: string; attributes: ChannexPhoto }>>("/photos?pagination[limit]=100");
  return (res.data ?? [])
    .map((p) => p.attributes)
    .filter((p) => p.property_id === channexPropertyId)
    .sort((a, b) => a.position - b.position);
}

export async function createPropertyPhoto(
  channexPropertyId: string,
  fields: { url: string; position: number; kind?: "photo" | "ad" | "menu"; description?: string; author?: string }
): Promise<ChannexPhoto> {
  const res = await channexPost<{ attributes: ChannexPhoto }>("/photos", {
    photo: { property_id: channexPropertyId, room_type_id: null, kind: "photo", ...fields },
  });
  if (!res.data) throw new Error("Channex returned no data creating the photo");
  return res.data.attributes;
}

export async function deleteChannexPhoto(photoId: string): Promise<void> {
  await channexDelete(`/photos/${photoId}`);
}
