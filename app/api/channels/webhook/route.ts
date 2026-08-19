import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processIncomingMessage } from "@/lib/ai";

// Generic webhook endpoint for OTA platforms
// Each platform sends reservations/messages in their own format
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const secret = searchParams.get("secret");

  // Basic webhook secret validation
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  switch (platform) {
    case "booking":
      return handleBookingWebhook(body);
    case "airbnb":
      return handleAirbnbWebhook(body);
    case "vrbo":
      return handleVrboWebhook(body);
    default:
      return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
}

async function handleBookingWebhook(payload: Record<string, unknown>) {
  // Booking.com sends events like reservation_new, reservation_modified, message_received
  const event = payload.event as string;

  if (event === "reservation_new" || event === "reservation_modified") {
    const res = payload.reservation as Record<string, unknown>;
    const channel = await prisma.channelConfig.findFirst({
      where: {
        channel: "BOOKING",
        listingId: String(res.hotel_id || res.property_id || ""),
      },
    });

    if (!channel) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    let guest = await prisma.guest.findFirst({
      where: { email: String(res.guest_email || "") },
    });
    if (!guest) {
      guest = await prisma.guest.create({
        data: {
          name: String(res.guest_name || "Guest"),
          email: String(res.guest_email || "") || undefined,
          phone: String(res.guest_phone || "") || undefined,
        },
      });
    }

    await prisma.reservation.upsert({
      where: {
        id: String(res.reservation_id || ""),
      },
      create: {
        id: String(res.reservation_id),
        externalId: String(res.reservation_id),
        confirmationCode: String(res.confirmation_number || ""),
        propertyId: channel.propertyId,
        guestId: guest.id,
        checkIn: new Date(String(res.checkin)),
        checkOut: new Date(String(res.checkout)),
        source: "BOOKING",
        status: String(res.status || "CONFIRMED").toUpperCase(),
        totalAmount: Number(res.total_price || 0) || undefined,
        currency: String(res.currency || "EUR"),
      },
      update: {
        status: String(res.status || "CONFIRMED").toUpperCase(),
        checkIn: new Date(String(res.checkin)),
        checkOut: new Date(String(res.checkout)),
        totalAmount: Number(res.total_price || 0) || undefined,
      },
    });
  }

  if (event === "message_received") {
    const msg = payload.message as Record<string, unknown>;
    const reservation = await prisma.reservation.findFirst({
      where: { externalId: String(msg.reservation_id || "") },
    });

    if (reservation) {
      const message = await prisma.message.create({
        data: {
          body: String(msg.body || ""),
          direction: "INBOUND",
          channel: "PLATFORM",
          source: "booking",
          reservationId: reservation.id,
        },
      });

      // Trigger AI auto-reply
      await processIncomingMessage(message.id);
    }
  }

  return NextResponse.json({ success: true });
}

async function handleAirbnbWebhook(payload: Record<string, unknown>) {
  // Airbnb webhook handling (similar structure)
  const type = payload.type as string;

  if (type === "reservations_new" || type === "reservations_update") {
    // Handle Airbnb reservation events
    // Implementation follows Airbnb's API spec
  }

  return NextResponse.json({ success: true });
}

async function handleVrboWebhook(_payload: Record<string, unknown>) {
  // VRBO/Expedia webhook handling
  return NextResponse.json({ success: true });
}
