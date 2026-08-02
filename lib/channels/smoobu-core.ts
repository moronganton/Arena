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

export interface DayRate { price: number | null; minStay: number | null; available: number | null; }

// Read the live rate calendar for one apartment from Smoobu (set by whatever
// manages pricing there, e.g. PriceLabs). Read-only — never writes. The working
// query format is apartments%5B%5D=<id> (encoded brackets), verified against
// the account; other formats 401/422.
export async function getSmoobuRates(
  userId: string,
  apartmentId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, DayRate>> {
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Smoobu not connected");

  const path = `/rates?apartments%5B%5D=${apartmentId}&start_date=${startDate}&end_date=${endDate}`;
  const data = await smoobuFetch(account.apiKey, path);
  const apt: Record<string, { price?: number; min_length_of_stay?: number; available?: number }> =
    data?.data?.[apartmentId] ?? data?.data?.[Number(apartmentId)] ?? {};

  const out: Record<string, DayRate> = {};
  for (const [date, v] of Object.entries(apt)) {
    out[date] = {
      price: typeof v?.price === "number" ? v.price : null,
      minStay: typeof v?.min_length_of_stay === "number" ? v.min_length_of_stay : null,
      available: typeof v?.available === "number" ? v.available : null,
    };
  }
  return out;
}

// Read rates for MANY apartments in one call (for the calendar overlay).
// Returns { [apartmentId]: { [date]: DayRate } }.
export async function getSmoobuRatesMulti(
  userId: string,
  apartmentIds: string[],
  startDate: string,
  endDate: string
): Promise<Record<string, Record<string, DayRate>>> {
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Smoobu not connected");
  if (apartmentIds.length === 0) return {};

  const aptParams = apartmentIds.map((id) => `apartments%5B%5D=${id}`).join("&");
  const path = `/rates?${aptParams}&start_date=${startDate}&end_date=${endDate}`;
  const data = await smoobuFetch(account.apiKey, path);
  const root: Record<string, Record<string, { price?: number; min_length_of_stay?: number; available?: number }>> =
    data?.data ?? {};

  const out: Record<string, Record<string, DayRate>> = {};
  for (const [aptId, byDate] of Object.entries(root)) {
    const days: Record<string, DayRate> = {};
    for (const [date, v] of Object.entries(byDate || {})) {
      days[date] = {
        price: typeof v?.price === "number" ? v.price : null,
        minStay: typeof v?.min_length_of_stay === "number" ? v.min_length_of_stay : null,
        available: typeof v?.available === "number" ? v.available : null,
      };
    }
    out[aptId] = days;
  }
  return out;
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

    // Direction: Smoobu's `type` is authoritative — 1 = written by the guest,
    // 2 = written by the host.
    //
    // An earlier version additionally required a non-empty htmlMessage before
    // calling a message host-sent. That field is only filled in when the
    // message was composed through Smoobu itself: replies typed in the
    // Booking.com extranet arrive as type 2 with htmlMessage "", so every one
    // of them was imported as a guest message.
    //
    // (type 2, htmlMessage "") is genuinely ambiguous — an email-relayed guest
    // message can look identical, and no other field in the payload separates
    // them. Host is the safer reading of the two: filing a host message as the
    // guest feeds the AI the host's own words as if the guest had said them,
    // and it answers a question the host already answered. The reverse merely
    // puts a message on the wrong side. Duplicate guest text arriving as an
    // outgoing entry is caught by the echo checks below instead.
    const type = Number(m.type ?? 0);
    const direction = type === 2 ? "OUTBOUND" : "INBOUND";

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
      // Repair rows stored with the wrong direction under an earlier mapping,
      // in both directions. Only importer-created rows are ever touched, never
      // StayHQ's own sends or AI replies.
      if (
        exists.source === "smoobu" &&
        exists.direction !== direction &&
        !exists.senderId &&
        !exists.isAiGenerated
      ) {
        await prisma.message.update({
          where: { id: exists.id },
          data:
            direction === "INBOUND"
              ? { direction: "INBOUND" }
              : // A host message filed as the guest's also left a false "needs
                // your reply" flag and an unread badge behind — clear both.
                { direction: "OUTBOUND", needsHostReply: false, isRead: true },
        });
        console.log(`[smoobu-messages] repaired ${msgId}: ${exists.direction} -> ${direction}`);
        if (direction === "INBOUND") newInboundIds.push(exists.id);
        continue;
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
  message: string
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
      await smoobuPost(account.apiKey, path, { messageBody: message });
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
