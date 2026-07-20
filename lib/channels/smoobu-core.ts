import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const SMOOBU_BASE_URL = "https://login.smoobu.com/api";

// The stored credential is JSON. Smoobu supports a legacy plain Api-Key and
// (since 2026) HMAC-SHA256 signed requests using a key id (usr_live_...) + secret.
export interface SmoobuCredential {
  scheme: "apikey" | "bearer" | "basic" | "hmac";
  value: string;
  keyId?: string;
  variant?: number;
}

// HMAC canonicalization variants (connect() discovers the right one).
export const HMAC_VARIANTS = [
  { apiPrefix: true, hashEncoding: "hex" as const },
  { apiPrefix: true, hashEncoding: "base64" as const },
  { apiPrefix: false, hashEncoding: "hex" as const },
  { apiPrefix: false, hashEncoding: "base64" as const },
];

function hmacHeaders(
  keyId: string,
  secret: string,
  variantIdx: number,
  method: string,
  fullPath: string,
  body: string
): Record<string, string> {
  const variant = HMAC_VARIANTS[variantIdx] || HMAC_VARIANTS[0];
  const [rawPath, rawQuery] = fullPath.split("?");
  const path = variant.apiPrefix ? `/api${rawPath}` : rawPath;
  const query = rawQuery ? rawQuery.split("&").sort().join("&") : "";
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash("sha256").update(body).digest(variant.hashEncoding);

  const canonical = [method.toUpperCase(), path, query, timestamp, nonce, bodyHash, keyId].join("\n");
  const signature = crypto.createHmac("sha256", secret).update(canonical).digest("base64");

  return {
    "X-API-Key": keyId,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": signature,
  };
}

export function buildHeaders(
  cred: SmoobuCredential,
  method: string,
  fullPath: string,
  body = ""
): Record<string, string> {
  if (cred.scheme === "hmac") {
    return hmacHeaders(cred.keyId || "", cred.value, cred.variant ?? 0, method, fullPath, body);
  }
  if (cred.scheme === "bearer") return { Authorization: `Bearer ${cred.value}` };
  if (cred.scheme === "basic") return { Authorization: `Basic ${cred.value}` };
  return { "Api-Key": cred.value };
}

export function parseCredential(stored: string): SmoobuCredential {
  try {
    const parsed = JSON.parse(stored);
    if (parsed.scheme && parsed.value) return parsed;
  } catch {
    // legacy plain API key
  }
  return { scheme: "apikey", value: stored };
}

export async function smoobuFetch(storedCred: string, path: string) {
  const cred = parseCredential(storedCred);
  const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
    headers: { ...buildHeaders(cred, "GET", path), "Cache-Control": "no-cache" },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Invalid Smoobu API credentials");
  if (!res.ok) throw new Error(`Smoobu API error ${res.status}`);
  return res.json();
}

export async function smoobuPost(storedCred: string, path: string, bodyObj: unknown) {
  const cred = parseCredential(storedCred);
  const body = JSON.stringify(bodyObj);
  const res = await fetch(`${SMOOBU_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...buildHeaders(cred, "POST", path, body),
      "Content-Type": "application/json",
    },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("Invalid Smoobu API credentials") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Smoobu API error ${res.status}: ${text.slice(0, 150)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

// Pull the message thread for a Smoobu reservation and import any messages
// StayHQ doesn't have yet. Returns the ids of newly imported inbound messages
// so callers can hand them to the AI assistant.
export async function syncSmoobuMessagesForReservation(
  userId: string,
  reservation: { id: string; externalId: string | null }
): Promise<string[]> {
  const newInboundIds: string[] = [];
  if (!reservation.externalId?.startsWith("smoobu-")) return newInboundIds;
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) return newInboundIds;

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  // onlyRelatedToGuest=false → include host-sent messages (type 2 = outbox),
  // so messages typed directly in Smoobu/Airbnb also appear in StayHQ.
  // The endpoint is paginated like the bookings list — long threads overflow
  // page 1, so walk every page or new messages are silently missed.
  const messages: Array<Record<string, unknown>> = [];
  try {
    let page = 1;
    let pageCount = 1;
    while (page <= Math.min(pageCount, 20)) {
      const data = await smoobuFetch(
        account.apiKey,
        `/reservations/${smoobuId}/messages?onlyRelatedToGuest=false&pageSize=100&page=${page}`
      );
      if (Array.isArray(data)) {
        messages.push(...data);
        break;
      }
      pageCount = Number(data.page_count) || 1;
      const batch: Array<Record<string, unknown>> = data.messages || [];
      messages.push(...batch);
      if (batch.length === 0) break;
      page++;
    }
    console.log(
      `[smoobu-messages] ${reservation.externalId}: fetched ${messages.length} message(s) across ${page > pageCount ? pageCount : page} page(s)`
    );
  } catch (err) {
    console.error(`[smoobu-messages] fetch failed for ${reservation.externalId}:`, err);
    return newInboundIds;
  }

  for (const m of messages) {
    const msgId = m.id != null ? `smoobu-msg-${m.id}` : null;
    if (!msgId) continue;

    // Strip HTML tags Smoobu may include
    const rawBody = String(m.message ?? m.messageBody ?? m.body ?? "");
    const body = rawBody.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    if (!body) {
      console.log(`[smoobu-messages] skipped ${msgId}: empty body; raw: ${JSON.stringify(m).slice(0, 300)}`);
      continue;
    }

    // Direction: Smoobu's type field alone is unreliable — some genuine guest
    // messages (e.g. relayed by email instead of the channel thread) arrive as
    // type 2 just like host messages. Genuinely host-sent messages always carry
    // a non-empty htmlMessage (rendered email HTML or Smoobu-composed text);
    // guest-authored messages never do. So: type 2 + htmlMessage → host,
    // everything else → guest.
    const type = Number(m.type ?? 0);
    const htmlBody = String(m.htmlMessage ?? m.messageHtml ?? "").trim();
    const direction = type === 2 && htmlBody ? "OUTBOUND" : "INBOUND";

    const exists = await prisma.message.findFirst({ where: { externalId: msgId } });
    if (!exists) {
      console.log(`[smoobu-messages] new msg ${msgId} type=${type} -> ${direction}; raw: ${JSON.stringify(m).slice(0, 300)}`);
    }
    if (exists) {
      // Clean up host-side echoes of guest messages imported before the echo
      // check below existed: an outgoing row that duplicates an inbound one.
      if (
        exists.direction === "OUTBOUND" &&
        exists.source === "smoobu" &&
        !exists.senderId &&
        !exists.isAiGenerated
      ) {
        const guestTwin = await prisma.message.findFirst({
          where: {
            reservationId: reservation.id,
            direction: "INBOUND",
            body,
            id: { not: exists.id },
          },
        });
        if (guestTwin) {
          await prisma.message.delete({ where: { id: exists.id } });
          console.log(`[smoobu-messages] removed ${msgId}: host-side echo of inbound message`);
          continue;
        }
      }
      // Repair guest messages imported as host-sent under the old type-only
      // mapping: flip them back to INBOUND and let the AI process them.
      // (Only this direction — host rows are never flipped to guest.)
      if (
        exists.source === "smoobu" &&
        exists.direction === "OUTBOUND" &&
        direction === "INBOUND" &&
        !exists.senderId &&
        !exists.isAiGenerated
      ) {
        await prisma.message.update({
          where: { id: exists.id },
          data: { direction: "INBOUND" },
        });
        console.log(`[smoobu-messages] repaired ${msgId}: OUTBOUND -> INBOUND (guest message mislabeled type=2)`);
        newInboundIds.push(exists.id);
        continue;
      }
      if (exists.source === "smoobu" && exists.direction !== direction) {
        console.log(
          `[smoobu-messages] note ${msgId}: stored=${exists.direction} but heuristic says ${direction}; ` +
          `keeping stored direction; raw: ${JSON.stringify(m).slice(0, 300)}`
        );
      }
      continue;
    }

    if (direction === "OUTBOUND") {
      // Skip StayHQ's own relayed copy; tag it for future syncs
      const hostCopy = await prisma.message.findFirst({
        where: { reservationId: reservation.id, direction: "OUTBOUND", body, externalId: null },
      });
      if (hostCopy) {
        await prisma.message.update({ where: { id: hostCopy.id }, data: { externalId: msgId } });
        continue;
      }
      // Some channels echo the guest's own message back as an outgoing entry.
      // If this exact text already exists as an inbound guest message, it's an
      // echo — importing it would show the guest's question on the host side.
      const guestEcho = await prisma.message.findFirst({
        where: { reservationId: reservation.id, direction: "INBOUND", body },
      });
      if (guestEcho) {
        console.log(`[smoobu-messages] skipped ${msgId}: host-side echo of inbound message`);
        continue;
      }
    }

    const created = await prisma.message.create({
      data: {
        reservationId: reservation.id,
        body,
        direction,
        channel: "PLATFORM",
        source: "smoobu",
        externalId: msgId,
        isRead: direction === "OUTBOUND",
      },
    });
    if (direction === "INBOUND") newInboundIds.push(created.id);
  }

  return newInboundIds;
}

// Send a message to the guest via Smoobu, which relays it through the booking
// channel (Booking.com / Airbnb) when possible. reservationExternalId is the
// StayHQ externalId, e.g. "smoobu-12345".
// Booking.com/Airbnb drop rapid bursts of guest messages, so we serialize all
// guest-message sends process-wide and keep a minimum gap between them. When the
// AI answers several questions at once, the replies go out one-by-one, spaced,
// instead of all in the same instant.
const MIN_SEND_GAP_MS = 2500;
let lastGuestSendAt = 0;
let sendGate: Promise<void> = Promise.resolve();
function reserveSendSlot(): Promise<void> {
  const slot = sendGate.then(async () => {
    const wait = lastGuestSendAt + MIN_SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGuestSendAt = Date.now();
  });
  sendGate = slot.catch(() => {});
  return slot;
}

export async function sendSmoobuGuestMessage(
  userId: string,
  reservationExternalId: string,
  message: string,
  subject = "Message from your host"
): Promise<boolean> {
  if (!reservationExternalId.startsWith("smoobu-")) return false;
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) return false;

  const smoobuId = reservationExternalId.replace("smoobu-", "");
  const path = `/reservations/${smoobuId}/messages/send-message-to-guest`;

  // Wait for our turn in the global send queue (spaces out bursts)
  await reserveSendSlot();

  // Booking.com/Airbnb (via Smoobu) rate-limit bursts — when the AI answers a
  // handful of questions at once, some sends come back 429/5xx. Retry those
  // with exponential backoff so replies aren't silently dropped. Only retry
  // errors that mean the message did NOT go through (rate limit / server /
  // network); a duplicate would otherwise reach the guest.
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Smoobu's documented example for this endpoint always pairs messageBody
      // with subject. Omitting it still returned "201 Resource created" but the
      // message never showed up in Smoobu's own thread or reached the guest —
      // it appears to accept the call but not create a real relayed message
      // without it.
      await smoobuPost(account.apiKey, path, { subject, messageBody: message });
      if (attempt > 1) console.log(`[smoobu-send] delivered on attempt ${attempt} for ${reservationExternalId}`);
      return true;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const retryable = status === 429 || status === undefined || (typeof status === "number" && status >= 500);
      if (!retryable || attempt === maxAttempts) break;
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(
        `[smoobu-send] attempt ${attempt} failed (status ${status ?? "network"}) for ${reservationExternalId}; retrying in ${delayMs}ms`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
