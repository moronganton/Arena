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
  if (res.status === 401 || res.status === 403) throw new Error("Invalid Smoobu API credentials");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smoobu API error ${res.status}: ${text.slice(0, 150)}`);
  }
  return res.json().catch(() => ({}));
}

// Pull the message thread for a Smoobu reservation and import any messages
// StayHQ doesn't have yet. Returns the number of new inbound messages.
export async function syncSmoobuMessagesForReservation(
  userId: string,
  reservation: { id: string; externalId: string | null }
): Promise<number> {
  if (!reservation.externalId?.startsWith("smoobu-")) return 0;
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) return 0;

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  let data: { messages?: Array<Record<string, unknown>> };
  try {
    data = await smoobuFetch(account.apiKey, `/reservations/${smoobuId}/messages`);
  } catch (err) {
    console.error(`[smoobu-messages] fetch failed for ${reservation.externalId}:`, err);
    return 0;
  }

  const messages = Array.isArray(data) ? data : data.messages || [];
  let imported = 0;

  for (const m of messages) {
    const msgId = m.id != null ? `smoobu-msg-${m.id}` : null;
    if (!msgId) continue;

    // Strip HTML tags Smoobu may include
    const rawBody = String(m.message ?? m.messageBody ?? m.body ?? "");
    const body = rawBody.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    if (!body) continue;

    // Smoobu direction: type 1 = incoming (guest), type 2 = outgoing (host).
    const type = Number(m.type ?? 0);
    const direction = type === 2 ? "OUTBOUND" : "INBOUND";
    console.log(`[smoobu-messages] msg ${msgId} type=${type} -> ${direction}; raw: ${JSON.stringify(m).slice(0, 200)}`);

    const exists = await prisma.message.findFirst({ where: { externalId: msgId } });
    if (exists) {
      // Self-repair: fix rows imported under earlier, incorrect mappings
      if (exists.source === "smoobu" && exists.direction !== direction) {
        await prisma.message.update({
          where: { id: exists.id },
          data: { direction, isRead: direction === "OUTBOUND" ? true : exists.isRead },
        });
        console.log(`[smoobu-messages] repaired ${msgId}: ${exists.direction} -> ${direction}`);
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
    }

    await prisma.message.create({
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
    if (direction === "INBOUND") imported++;
  }

  return imported;
}

// Send a message to the guest via Smoobu, which relays it through the booking
// channel (Booking.com / Airbnb) when possible. reservationExternalId is the
// StayHQ externalId, e.g. "smoobu-12345".
export async function sendSmoobuGuestMessage(
  userId: string,
  reservationExternalId: string,
  message: string
): Promise<boolean> {
  if (!reservationExternalId.startsWith("smoobu-")) return false;
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) return false;

  const smoobuId = reservationExternalId.replace("smoobu-", "");
  await smoobuPost(account.apiKey, `/reservations/${smoobuId}/messages/send-message-to-guest`, {
    messageBody: message,
  });
  return true;
}
