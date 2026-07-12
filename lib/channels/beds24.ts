import { prisma } from "@/lib/prisma";
import {
  autoGenerateCodesForReservation,
  revokeAccessCodesForReservation,
  updateAccessCodePeriodsForReservation,
} from "@/lib/ttlock";

const BASE_URL = "https://beds24.com/api/v2";

interface Beds24Booking {
  id: number;
  propertyId: number;
  roomId?: number;
  status: string; // confirmed, request, new, cancelled, black, inquiry
  arrival: string; // YYYY-MM-DD
  departure: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  numAdult?: number;
  numChild?: number;
  price?: number;
  currency?: string;
  referer?: string;
  channel?: string;
  apiSource?: string;
  comments?: string;
}

// Exchange a one-time invite code for a long-lived refresh token
export async function connectBeds24(userId: string, inviteCode: string) {
  const res = await fetch(`${BASE_URL}/authentication/setup`, {
    headers: { code: inviteCode.trim() },
  });
  const data = await res.json();

  if (!data.refreshToken) {
    throw new Error(
      data.error || data.message || "Invalid or expired invite code. Generate a new one in Beds24 (Settings → API)."
    );
  }

  return prisma.beds24Account.upsert({
    where: { userId },
    create: {
      userId,
      refreshToken: data.refreshToken,
      token: data.token ?? null,
      expiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
    },
    update: {
      refreshToken: data.refreshToken,
      token: data.token ?? null,
      expiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
    },
  });
}

// Get a valid short-lived token, refreshing when needed. Null if not connected.
export async function getBeds24Token(userId: string): Promise<string | null> {
  const account = await prisma.beds24Account.findUnique({ where: { userId } });
  if (!account) return null;

  if (account.token && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60_000) {
    return account.token;
  }

  const res = await fetch(`${BASE_URL}/authentication/token`, {
    headers: { refreshToken: account.refreshToken },
  });
  const data = await res.json();
  if (!data.token) {
    console.error("Beds24 token refresh failed:", data);
    return null;
  }

  await prisma.beds24Account.update({
    where: { userId },
    data: {
      token: data.token,
      expiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
    },
  });

  return data.token;
}

async function fetchBeds24Properties(token: string): Promise<Array<{ id: string; name: string; currency?: string }>> {
  const res = await fetch(`${BASE_URL}/properties`, { headers: { token } });
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.data || [];
  return list.map((p: { id: number; name: string; currency?: string }) => ({
    id: String(p.id),
    name: p.name,
    currency: p.currency,
  }));
}

// List properties in the Beds24 account (for mapping to StayHQ properties)
export async function listBeds24Properties(userId: string): Promise<Array<{ id: string; name: string }>> {
  const token = await getBeds24Token(userId);
  if (!token) throw new Error("Beds24 account not connected");
  return fetchBeds24Properties(token);
}

function mapSource(b: Beds24Booking): string {
  const ref = `${b.referer || ""} ${b.channel || ""} ${b.apiSource || ""}`.toLowerCase();
  if (ref.includes("booking")) return "BOOKING";
  if (ref.includes("airbnb")) return "AIRBNB";
  if (ref.includes("vrbo") || ref.includes("homeaway")) return "VRBO";
  if (ref.includes("expedia")) return "EXPEDIA";
  return "DIRECT";
}

function mapStatus(status: string): string | null {
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "new") return "CONFIRMED";
  if (s === "request") return "PENDING";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  return null; // black (owner block), inquiry — not reservations
}

// Pull bookings from Beds24 and sync them into StayHQ.
// New confirmed bookings trigger automatic lock codes + guest PIN email.
export async function syncBeds24Bookings(userId: string): Promise<{
  imported: number;
  updated: number;
  cancelled: number;
  errors: string[];
}> {
  const token = await getBeds24Token(userId);
  if (!token) throw new Error("Beds24 account not connected");

  // Automation (PIN + guest emails) can be disabled while testing
  const account = await prisma.beds24Account.findUnique({ where: { userId } });
  const automationEnabled = account?.automationEnabled ?? false;

  // Property mappings are stored as ChannelConfig rows with channel=BEDS24
  const mappings = await prisma.channelConfig.findMany({
    where: { channel: "BEDS24", property: { ownerId: userId } },
    include: { property: true },
  });
  if (mappings.length === 0) {
    throw new Error("No properties mapped to Beds24 yet. Map them first.");
  }

  const result = { imported: 0, updated: 0, cancelled: 0, errors: [] as string[] };

  // Beds24 booking prices are in the Beds24 property's currency — fetch it
  // so imported amounts show the currency the booking was actually made in.
  const currencyByBeds24Property: Record<string, string> = {};
  try {
    for (const p of await fetchBeds24Properties(token)) {
      if (p.currency) currencyByBeds24Property[p.id] = p.currency.toUpperCase();
    }
  } catch (err) {
    console.error("Could not fetch Beds24 property currencies:", err);
  }

  // Look back 90 days so recent stays and modifications are covered
  const arrivalFrom = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

  for (const mapping of mappings) {
    if (!mapping.listingId) continue;

    let page = 1;
    while (page <= 10) {
      const params = new URLSearchParams({
        propertyId: mapping.listingId,
        arrivalFrom,
        page: String(page),
      });
      const res = await fetch(`${BASE_URL}/bookings?${params}`, { headers: { token } });
      const data = await res.json();
      const bookings: Beds24Booking[] = Array.isArray(data) ? data : data.data || [];
      if (bookings.length === 0) break;

      for (const b of bookings) {
        try {
          const status = mapStatus(b.status);
          if (!status) continue; // skip blocks/inquiries

          const externalId = `beds24-${b.id}`;
          const bookingCurrency =
            b.currency?.toUpperCase() ||
            currencyByBeds24Property[mapping.listingId] ||
            mapping.property.currency;
          const guestName = `${b.firstName || ""} ${b.lastName || ""}`.trim() || "Guest";
          const guestEmail = b.email || undefined;
          const guestPhone = b.phone || b.mobile || undefined;

          const existing = await prisma.reservation.findFirst({ where: { externalId } });

          if (!existing) {
            if (status === "CANCELLED") continue; // don't import already-cancelled history

            let guest = guestEmail
              ? await prisma.guest.findFirst({ where: { email: guestEmail } })
              : null;
            if (!guest) {
              guest = await prisma.guest.create({
                data: { name: guestName, email: guestEmail, phone: guestPhone },
              });
            }

            const reservation = await prisma.reservation.create({
              data: {
                externalId,
                confirmationCode: String(b.id),
                propertyId: mapping.propertyId,
                guestId: guest.id,
                checkIn: new Date(b.arrival),
                checkOut: new Date(b.departure),
                adults: b.numAdult ?? 1,
                children: b.numChild ?? 0,
                totalAmount: b.price ?? undefined,
                currency: bookingCurrency,
                source: mapSource(b),
                status,
                specialRequests: b.comments || undefined,
              },
            });
            result.imported++;

            // Same automation as manually created reservations: PIN + email
            if (status === "CONFIRMED" && automationEnabled) {
              await autoGenerateCodesForReservation(reservation.id, mapping.propertyId);
            }
          } else {
            const checkIn = new Date(b.arrival);
            const checkOut = new Date(b.departure);
            const datesChanged =
              existing.checkIn.getTime() !== checkIn.getTime() ||
              existing.checkOut.getTime() !== checkOut.getTime();
            const becameCancelled = status === "CANCELLED" && existing.status !== "CANCELLED";

            await prisma.reservation.update({
              where: { id: existing.id },
              data: {
                status,
                checkIn,
                checkOut,
                adults: b.numAdult ?? existing.adults,
                children: b.numChild ?? existing.children,
                totalAmount: b.price ?? existing.totalAmount,
                currency: bookingCurrency,
              },
            });

            if (becameCancelled) {
              await revokeAccessCodesForReservation(existing.id, userId);
              result.cancelled++;
            } else if (datesChanged && status === "CONFIRMED") {
              await updateAccessCodePeriodsForReservation(existing.id, userId, checkIn, checkOut);
              result.updated++;
            } else {
              result.updated++;
            }
          }
        } catch (err) {
          result.errors.push(
            `Booking ${b.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (bookings.length < 100) break; // last page
      page++;
    }

    await prisma.channelConfig.update({
      where: { id: mapping.id },
      data: { lastSyncAt: new Date() },
    });
  }

  return result;
}
