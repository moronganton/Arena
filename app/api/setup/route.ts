import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const existing = await prisma.user.findUnique({ where: { email: "demo@stayhq.com" } });
  if (existing) {
    return NextResponse.json({ message: "Already set up. You can log in now.", email: "demo@stayhq.com", password: "demo123" });
  }

  const user = await prisma.user.create({
    data: { email: "demo@stayhq.com", name: "Demo Host", password: "demo123" },
  });

  const villa = await prisma.property.create({
    data: {
      id: "prop-1",
      name: "Villa Bella Vista",
      address: "Calle del Mar 42",
      city: "Barcelona",
      country: "Spain",
      description: "Stunning villa with sea views, private pool and garden. 5 minutes from the beach.",
      bedrooms: 3, bathrooms: 2, maxGuests: 6, basePrice: 280,
      currency: "EUR", timezone: "Europe/Madrid", ownerId: user.id,
    },
  });

  const apartment = await prisma.property.create({
    data: {
      id: "prop-2",
      name: "Loft Central Lisboa",
      address: "Rua Augusta 156, 3º Dto",
      city: "Lisbon",
      country: "Portugal",
      description: "Stylish loft in the heart of Baixa, perfect for couples.",
      bedrooms: 1, bathrooms: 1, maxGuests: 2, basePrice: 120,
      currency: "EUR", timezone: "Europe/Lisbon", ownerId: user.id,
    },
  });

  const cottage = await prisma.property.create({
    data: {
      id: "prop-3",
      name: "Lakeside Cottage",
      address: "23 Lakeview Drive",
      city: "Interlaken",
      country: "Switzerland",
      description: "Cozy cottage with breathtaking mountain lake views.",
      bedrooms: 2, bathrooms: 1, maxGuests: 4, basePrice: 350,
      currency: "CHF", timezone: "Europe/Zurich", ownerId: user.id,
    },
  });

  const guests = await Promise.all([
    prisma.guest.create({ data: { id: "guest-1", name: "Sophie Laurent", email: "sophie@example.com", phone: "+33 6 12 34 56 78", language: "fr" } }),
    prisma.guest.create({ data: { id: "guest-2", name: "Marcus Johnson", email: "marcus@example.com", phone: "+1 555 987 6543", language: "en" } }),
    prisma.guest.create({ data: { id: "guest-3", name: "Elena Rossi", email: "elena@example.com", phone: "+39 333 456 7890", language: "it" } }),
    prisma.guest.create({ data: { id: "guest-4", name: "Thomas Müller", email: "thomas@example.com", language: "de" } }),
  ]);

  const today = new Date();
  const d = (days: number) => new Date(today.getTime() + days * 86400000);

  const reservations = await Promise.all([
    prisma.reservation.create({ data: { id: "res-1", propertyId: villa.id, guestId: guests[0].id, checkIn: d(2), checkOut: d(9), adults: 4, totalAmount: 1960, currency: "EUR", source: "AIRBNB", status: "CONFIRMED", confirmationCode: "HM7829341" } }),
    prisma.reservation.create({ data: { id: "res-2", propertyId: apartment.id, guestId: guests[1].id, checkIn: d(-1), checkOut: d(3), adults: 2, totalAmount: 480, currency: "EUR", source: "BOOKING", status: "CHECKED_IN", confirmationCode: "BK-2847361" } }),
    prisma.reservation.create({ data: { id: "res-3", propertyId: cottage.id, guestId: guests[2].id, checkIn: d(14), checkOut: d(21), adults: 2, children: 1, totalAmount: 2450, currency: "CHF", source: "VRBO", status: "CONFIRMED", confirmationCode: "VB-99123" } }),
    prisma.reservation.create({ data: { id: "res-4", propertyId: villa.id, guestId: guests[3].id, checkIn: d(20), checkOut: d(27), adults: 3, totalAmount: 1960, currency: "EUR", source: "DIRECT", status: "CONFIRMED", confirmationCode: "DIR-2024-05" } }),
  ]);

  await prisma.message.createMany({
    data: [
      { id: "msg-1", reservationId: "res-1", body: "Hello! I'm arriving late around 10pm. Is that okay? Also what is the WiFi password?", direction: "INBOUND", channel: "PLATFORM", source: "airbnb", isRead: false },
      { id: "msg-2", reservationId: "res-2", body: "Hi Marcus! We're so happy to have you. Your access code is 847291. WiFi: VilaGuest / Lisboa2024. Enjoy your stay!", direction: "OUTBOUND", channel: "EMAIL", source: "booking", isRead: true, isAiGenerated: true, senderId: user.id },
      { id: "msg-3", reservationId: "res-2", body: "Thank you! Is there parking nearby?", direction: "INBOUND", channel: "PLATFORM", source: "booking", isRead: true },
    ],
  });

  await prisma.smartLock.createMany({
    data: [
      { id: "lock-1", ttlockId: "ttlock-villa-001", name: "Front Door", batteryLevel: 85, lockType: "PIN", isActive: true, propertyId: villa.id },
      { id: "lock-2", ttlockId: "ttlock-loft-001", name: "Main Entrance", batteryLevel: 62, lockType: "PIN", isActive: true, propertyId: apartment.id },
    ],
  });

  await prisma.accessCode.create({
    data: { id: "code-1", code: "847291", validFrom: reservations[1].checkIn, validTo: reservations[1].checkOut, lockId: "lock-2", reservationId: "res-2", sentToGuest: true, sentAt: new Date() },
  });

  await prisma.aiSettings.create({
    data: {
      userId: user.id, enabled: true, autoReplyEnabled: true, confidenceThreshold: 0.8, language: "en",
      customInstructions: "- Villa WiFi: VilaGuest | Barcelona2024!\n- Loft WiFi: LoftNet | Lisboa2024\n- Check-in: 3pm. Check-out: 11am.\n- No pets, no smoking, no parties",
    },
  });

  await prisma.pricingRule.createMany({
    data: [
      { id: "rule-1", propertyId: villa.id, name: "Weekend Surcharge", ruleType: "WEEKEND", daysOfWeek: JSON.stringify([5, 6]), adjustment: 20, adjType: "PERCENT", priority: 10 },
      { id: "rule-2", propertyId: villa.id, name: "Summer Season", ruleType: "SEASONAL", startDate: new Date(`${today.getFullYear()}-06-01`), endDate: new Date(`${today.getFullYear()}-08-31`), adjustment: 35, adjType: "PERCENT", minNights: 5, priority: 20 },
    ],
  });

  return NextResponse.json({
    message: "Setup complete! You can now log in.",
    email: "demo@stayhq.com",
    password: "demo123",
  });
}
