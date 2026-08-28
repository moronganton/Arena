// Photos stored as data URLs, compressed on the device before they ever leave it.
//
// The app has no object store and Railway's filesystem does not survive a
// deploy, so an uploaded image has to live in Postgres. That is fine at this
// scale provided it is small, which is the whole job of compressImage: a
// 12 MP phone photo becomes roughly 100-200 KB before it is sent, instead of
// a 6 MB row that every page load then drags across the wire.
//
// This is the third place in the app that needed it - cleaning photos and
// template attachments already did the same thing inline - so it lives here
// now and those can converge on it.

/** Longest edge, in pixels, after compression. */
export const MAX_EDGE = 1024;
/** JPEG quality. 0.7 is the value the cleaning-photo flow has used in production. */
export const JPEG_QUALITY = 0.7;
/**
 * Refuse anything that would bloat a row. Checked after compression, so it
 * only trips on genuinely pathological input rather than on a big original.
 */
export const MAX_STORED_BYTES = 1_500_000;

/** Roughly how many bytes a data URL's payload decodes to. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Whether a string is something we are willing to store in an image field.
 * Accepts an inline image (what the uploader produces) or an http(s) URL (what
 * properties created before the uploader existed still hold), and rejects
 * everything else - notably `data:text/html`, which would otherwise be a
 * stored-XSS vector the moment anything rendered it outside an <img>.
 */
export function isAcceptableImageSrc(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value)) return false;
  return dataUrlBytes(value) <= MAX_STORED_BYTES;
}

/**
 * Scale so the longest edge is at most `maxEdge`, never enlarging a small
 * image. Pure, so the arithmetic is testable without a canvas.
 */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Browser-only: read a File, downscale it on a canvas, and return a JPEG data
 * URL. Rejects if the file is not a decodable image.
 */
export function compressImage(
  file: File,
  maxEdge: number = MAX_EDGE,
  quality: number = JPEG_QUALITY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const { width, height } = scaledSize(img.width, img.height, maxEdge);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Could not process this image"));
      } finally {
        // Always released, including on the throw path - a leaked object URL
        // pins the whole decoded bitmap in memory.
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image"));
    };
    img.src = url;
  });
}
