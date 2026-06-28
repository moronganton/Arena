import { prisma } from "@/lib/prisma";

const BOOKING_API_BASE = "https://partner.api.booking.com/v3";

interface BookingReservation {
  id: string;
  arrival_date: string;
  departure_date: string;
  status: string;
  booker?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    country?: string;
  };
  price?: {
    total?: { value?: number; currency?: string };
  };
  guest_adults?: number;
  guest_children?: number;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  number_of_adults?: number;
  number_of_children?: number;
  total_price?: number;
  currency?: string;
  reservation_id?: string;
  confirmation_number?: string;
  special_requests?: string;
}

function mapStatus(s: string): string {
  const lower = s.toLowerCase();
  if (lower === "ok" || lower === "confirmed") return "CONFIRMED";
  if (lower === "cancelled" || lower === "canceled") return "CANCELLED";
  if (lower === "no_show" || lower === "no-show") return "NO_SHOW";
  return "CONFIRMED";
}

export async function syncBookingReservations(channelId: string): Promise<{
  imported: number;
  updated: number;
  errors: string[];
}> {
  const channel = await prisma.channelConfig.findUnique({
    where: { id: channelId },
    include: { property: true },
  });

  if (!channel) throw new Error("Channel not found");
  if (!channel.apiKey || !channel.listingId) {
    throw new Error("Booking.com credentials (API username, password, hotel ID) are required");
  }

  const password = channel.apiSecret ?? "";
  const credentials = Buffer.from(`${channel.apiKey}:${password}`).toString("base64");

  // Fetch reservations for a 2-year window (past 3 months + next 18 months)
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  const to = new Date();
  to.setMonth(to.getMonth() + 18);

  const params = new URLSearchParams({
    "hotel_ids[]": channel.listingId,
    arrival_date_from: from.toISOString().split("T")[0],
    arrival_date_to: to.toISOString().split("T")[0],
    rows_per_page: "100",
    page_number: "1",
  });

  const response = await fetch(`${BOOKING_API_BASE}/reservations?${params}`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Booking.com API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();

  // API returns { data: [...] } or directly an array
  const reservations: BookingReservation[] = Array.isArray(json)
    ? json
    : Array.isArray(json.data)
    ? json.data
    : [];

  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const r of reservations) {
    try {
      const externalId = String(r.id || r.reservation_id || "");
      if (!externalId) continue;

      // Resolve guest info from either v2 or v3 response shape
      const guestName =
        r.booker
          ? `${r.booker.first_name ?? ""} ${r.booker.last_name ?? ""}`.trim() || "Guest"
          : r.guest_name || "Guest";
      const guestEmail = r.booker?.email || r.guest_email || undefined;
      const guestPhone = r.booker?.phone || r.guest_phone || undefined;

      const totalAmount =
        r.price?.total?.value ?? r.total_price ?? undefined;
      const currency =
        r.price?.total?.currency ?? r.currency ?? channel.property.currency;

      const adults = r.guest_adults ?? r.number_of_adults ?? 1;
      const children = r.guest_children ?? r.number_of_children ?? 0;

      let guest = guestEmail
        ? await prisma.guest.findFirst({ where: { email: guestEmail } })
        : null;

      if (!guest) {
        guest = await prisma.guest.create({
          data: { name: guestName, email: guestEmail, phone: guestPhone },
        });
      } else {
        // Update name/phone if we have better info now
        if (guestName && guestName !== "Guest") {
          await prisma.guest.update({
            where: { id: guest.id },
            data: { name: guestName, phone: guestPhone ?? guest.phone ?? undefined },
          });
        }
      }

      const existing = await prisma.reservation.findFirst({
        where: { externalId },
      });

      if (existing) {
        await prisma.reservation.update({
          where: { id: existing.id },
          data: {
            status: mapStatus(r.status),
            checkIn: new Date(r.arrival_date),
            checkOut: new Date(r.departure_date),
            totalAmount: totalAmount ? Number(totalAmount) : undefined,
            adults,
            children,
          },
        });
        updated++;
      } else {
        await prisma.reservation.create({
          data: {
            externalId,
            confirmationCode: r.confirmation_number || externalId,
            source: "BOOKING",
            status: mapStatus(r.status),
            checkIn: new Date(r.arrival_date),
            checkOut: new Date(r.departure_date),
            totalAmount: totalAmount ? Number(totalAmount) : undefined,
            currency,
            adults,
            children,
            specialRequests: r.special_requests || undefined,
            propertyId: channel.propertyId,
            guestId: guest.id,
          },
        });
        imported++;
      }
    } catch (err) {
      errors.push(`Reservation ${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await prisma.channelConfig.update({
    where: { id: channelId },
    data: { lastSyncAt: new Date() },
  });

  return { imported, updated, errors };
}
