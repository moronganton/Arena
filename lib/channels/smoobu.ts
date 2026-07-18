import { prisma } from "@/lib/prisma";
import {
  autoGenerateCodesForReservation,
  revokeAccessCodesForReservation,
  updateAccessCodePeriodsForReservation,
} from "@/lib/ttlock";

const BASE_URL = "https://login.smoobu.com/api";

interface SmoobuBooking {
  id: number;
  type?: string; // "cancellation" when cancelled
  arrival: string; // YYYY-MM-DD
  departure: string;
  apartment?: { id: number; name: string };
  channel?: { id: number; name: string }; // e.g. "Booking.com", "Airbnb", "Direct booking"
  "guest-name"?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  adults?: number;
  children?: number;
  price?: number;
  currency?: string;
  notice?: string;
}

async function smoobuFetch(apiKey: string, path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Api-Key": apiKey, "Cache-Control": "no-cache" },
  });
  if (res.status === 401) throw new Error("Invalid Smoobu API key");
  if (!res.ok) throw new Error(`Smoobu API error ${res.status}`);
  return res.json();
}

// Verify an API key and store it
export async function connectSmoobu(userId: string, apiKey: string) {
  await smoobuFetch(apiKey.trim(), "/me"); // throws on invalid key
  return prisma.smoobuAccount.upsert({
    where: { userId },
    create: { userId, apiKey: apiKey.trim() },
    update: { apiKey: apiKey.trim() },
  });
}

// List apartments for the mapping screen
export async function listSmoobuApartments(userId: string): Promise<Array<{ id: string; name: string }>> {
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Smoobu account not connected");

  const data = await smoobuFetch(account.apiKey, "/apartments");
  const list = data.apartments || data || [];
  return list.map((a: { id: number; name: string }) => ({ id: String(a.id), name: a.name }));
}

function mapSource(b: SmoobuBooking): string {
  const name = (b.channel?.name || "").toLowerCase();
  if (name.includes("booking")) return "BOOKING";
  if (name.includes("airbnb")) return "AIRBNB";
  if (name.includes("vrbo") || name.includes("homeaway")) return "VRBO";
  if (name.includes("expedia")) return "EXPEDIA";
  return "DIRECT";
}

// Pull bookings from Smoobu and sync into StayHQ (same behavior as Beds24 sync)
export async function syncSmoobuBookings(userId: string): Promise<{
  imported: number;
  updated: number;
  cancelled: number;
  errors: string[];
}> {
  const account = await prisma.smoobuAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Smoobu account not connected");
  const automationEnabled = account.automationEnabled;

  const mappings = await prisma.channelConfig.findMany({
    where: { channel: "SMOOBU", property: { ownerId: userId } },
    include: { property: true },
  });
  if (mappings.length === 0) {
    throw new Error("No properties mapped to Smoobu yet. Map them first.");
  }
  const mappingByApartment = new Map(mappings.map((m) => [m.listingId, m]));

  // Apartment currency lookup (bookings are priced in the apartment's currency)
  const currencyByApartment: Record<string, string> = {};
  try {
    for (const m of mappings) {
      if (!m.listingId) continue;
      const detail = await smoobuFetch(account.apiKey, `/apartments/${m.listingId}`);
      const cur = detail?.currency || detail?.location?.currency;
      if (cur) currencyByApartment[m.listingId] = String(cur).toUpperCase();
    }
  } catch (err) {
    console.error("Could not fetch Smoobu apartment currencies:", err);
  }

  const from = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const to = new Date(Date.now() + 540 * 86400000).toISOString().split("T")[0];

  const result = { imported: 0, updated: 0, cancelled: 0, errors: [] as string[] };
  console.log(`[smoobu-sync] starting for user ${userId}, automationEnabled=${automationEnabled}`);

  let page = 1;
  let pageCount = 1;
  while (page <= Math.min(pageCount, 20)) {
    const data = await smoobuFetch(
      account.apiKey,
      `/reservations?from=${from}&to=${to}&page=${page}&pageSize=100&showCancellation=true`
    );
    pageCount = data.page_count || 1;
    const bookings: SmoobuBooking[] = data.bookings || [];

    for (const b of bookings) {
      try {
        const mapping = mappingByApartment.get(String(b.apartment?.id ?? ""));
        if (!mapping) continue; // apartment not mapped to StayHQ

        const isCancelled = (b.type || "").toLowerCase().includes("cancel");
        const status = isCancelled ? "CANCELLED" : "CONFIRMED";
        const externalId = `smoobu-${b.id}`;

        const guestName =
          b["guest-name"] ||
          `${b.firstname || ""} ${b.lastname || ""}`.trim() ||
          "Guest";
        const guestEmail = b.email || undefined;
        const guestPhone = b.phone || undefined;
        const bookingCurrency =
          b.currency?.toUpperCase() ||
          currencyByApartment[mapping.listingId!] ||
          mapping.property.currency;

        const existing = await prisma.reservation.findFirst({ where: { externalId } });

        if (!existing) {
          if (isCancelled) continue;

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
              adults: b.adults ?? 1,
              children: b.children ?? 0,
              totalAmount: b.price ?? undefined,
              currency: bookingCurrency,
              source: mapSource(b),
              status,
              specialRequests: b.notice || undefined,
            },
          });
          result.imported++;

          if (automationEnabled) {
            const gen = await autoGenerateCodesForReservation(reservation.id, mapping.propertyId);
            console.log(
              `[smoobu-sync] booking ${b.id}: generated ${gen.codes.length} code(s)` +
              (gen.errors.length ? `, errors: ${gen.errors.join("; ")}` : "")
            );
          }
        } else {
          const checkIn = new Date(b.arrival);
          const checkOut = new Date(b.departure);
          const datesChanged =
            existing.checkIn.getTime() !== checkIn.getTime() ||
            existing.checkOut.getTime() !== checkOut.getTime();
          const becameCancelled = isCancelled && existing.status !== "CANCELLED";

          await prisma.reservation.update({
            where: { id: existing.id },
            data: {
              status,
              checkIn,
              checkOut,
              adults: b.adults ?? existing.adults,
              children: b.children ?? existing.children,
              totalAmount: b.price ?? existing.totalAmount,
              currency: bookingCurrency,
            },
          });

          if (becameCancelled) {
            await revokeAccessCodesForReservation(existing.id, userId);
            result.cancelled++;
          } else if (datesChanged && !isCancelled) {
            await updateAccessCodePeriodsForReservation(existing.id, userId, checkIn, checkOut);
            result.updated++;
          } else {
            result.updated++;
          }
        }
      } catch (err) {
        result.errors.push(`Booking ${b.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (bookings.length === 0) break;
    page++;
  }

  await prisma.channelConfig.updateMany({
    where: { channel: "SMOOBU", property: { ownerId: userId } },
    data: { lastSyncAt: new Date() },
  });

  return result;
}
