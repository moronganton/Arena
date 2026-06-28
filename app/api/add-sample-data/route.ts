import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const user = await prisma.user.findUnique({ where: { email: "demo@stayhq.com" } });
  if (!user) {
    return NextResponse.json({ error: "Run /api/setup first to create the base account." }, { status: 400 });
  }

  const today = new Date();
  const d = (days: number) => new Date(today.getTime() + days * 86400000);

  // Extra guests
  const extraGuests = await Promise.all([
    prisma.guest.upsert({ where: { id: "guest-5" }, update: {}, create: { id: "guest-5", name: "Camille Dupont", email: "camille@example.com", phone: "+33 6 98 76 54 32", language: "fr" } }),
    prisma.guest.upsert({ where: { id: "guest-6" }, update: {}, create: { id: "guest-6", name: "Luca Bianchi", email: "luca@example.com", phone: "+39 347 123 4567", language: "it" } }),
    prisma.guest.upsert({ where: { id: "guest-7" }, update: {}, create: { id: "guest-7", name: "Anna Schmidt", email: "anna@example.com", phone: "+49 170 987 6543", language: "de" } }),
    prisma.guest.upsert({ where: { id: "guest-8" }, update: {}, create: { id: "guest-8", name: "James Wilson", email: "james@example.com", phone: "+44 7911 123456", language: "en" } }),
    prisma.guest.upsert({ where: { id: "guest-9" }, update: {}, create: { id: "guest-9", name: "María García", email: "maria@example.com", phone: "+34 612 345 678", language: "es" } }),
    prisma.guest.upsert({ where: { id: "guest-10" }, update: {}, create: { id: "guest-10", name: "Pieter van der Berg", email: "pieter@example.com", phone: "+31 6 12345678", language: "nl" } }),
  ]);

  // Extra reservations spread across past, current and future
  await Promise.all([
    prisma.reservation.upsert({ where: { id: "res-5" }, update: {}, create: { id: "res-5", propertyId: "prop-1", guestId: extraGuests[0].id, checkIn: d(-30), checkOut: d(-23), adults: 2, children: 1, totalAmount: 1960, currency: "EUR", source: "BOOKING", status: "CHECKED_OUT", confirmationCode: "BK-1192837" } }),
    prisma.reservation.upsert({ where: { id: "res-6" }, update: {}, create: { id: "res-6", propertyId: "prop-2", guestId: extraGuests[1].id, checkIn: d(-14), checkOut: d(-10), adults: 2, totalAmount: 480, currency: "EUR", source: "AIRBNB", status: "CHECKED_OUT", confirmationCode: "HM-4456789" } }),
    prisma.reservation.upsert({ where: { id: "res-7" }, update: {}, create: { id: "res-7", propertyId: "prop-3", guestId: extraGuests[2].id, checkIn: d(5), checkOut: d(12), adults: 4, totalAmount: 2450, currency: "CHF", source: "VRBO", status: "CONFIRMED", confirmationCode: "VB-00456" } }),
    prisma.reservation.upsert({ where: { id: "res-8" }, update: {}, create: { id: "res-8", propertyId: "prop-1", guestId: extraGuests[3].id, checkIn: d(30), checkOut: d(37), adults: 6, totalAmount: 3360, currency: "EUR", source: "EXPEDIA", status: "CONFIRMED", confirmationCode: "EX-9988112" } }),
    prisma.reservation.upsert({ where: { id: "res-9" }, update: {}, create: { id: "res-9", propertyId: "prop-2", guestId: extraGuests[4].id, checkIn: d(10), checkOut: d(14), adults: 2, totalAmount: 480, currency: "EUR", source: "DIRECT", status: "CONFIRMED", confirmationCode: "DIR-2024-09" } }),
    prisma.reservation.upsert({ where: { id: "res-10" }, update: {}, create: { id: "res-10", propertyId: "prop-3", guestId: extraGuests[5].id, checkIn: d(-7), checkOut: d(-3), adults: 3, totalAmount: 1400, currency: "CHF", source: "BOOKING", status: "CHECKED_OUT", confirmationCode: "BK-7743219" } }),
    prisma.reservation.upsert({ where: { id: "res-11" }, update: {}, create: { id: "res-11", propertyId: "prop-1", guestId: extraGuests[0].id, checkIn: d(45), checkOut: d(52), adults: 2, totalAmount: 1960, currency: "EUR", source: "AIRBNB", status: "PENDING", confirmationCode: "HM-9876001" } }),
    prisma.reservation.upsert({ where: { id: "res-12" }, update: {}, create: { id: "res-12", propertyId: "prop-2", guestId: extraGuests[2].id, checkIn: d(-3), checkOut: d(1), adults: 2, totalAmount: 360, currency: "EUR", source: "BOOKING", status: "CHECKED_IN", confirmationCode: "BK-5521009" } }),
  ]);

  // Extra messages
  await prisma.message.createMany({
    skipDuplicates: true,
    data: [
      { id: "msg-4", reservationId: "res-5", body: "Hello! Can we do early check-in at noon? We have a flight landing at 10am.", direction: "INBOUND", channel: "PLATFORM", source: "booking", isRead: false },
      { id: "msg-5", reservationId: "res-5", body: "Hi Camille! We can offer early check-in at 1pm for an extra €30. Please confirm if that works.", direction: "OUTBOUND", channel: "EMAIL", source: "booking", isRead: true, isAiGenerated: true, senderId: user.id },
      { id: "msg-6", reservationId: "res-6", body: "Is the pool heated in October?", direction: "INBOUND", channel: "PLATFORM", source: "airbnb", isRead: false },
      { id: "msg-7", reservationId: "res-7", body: "What is the nearest supermarket and how far is it?", direction: "INBOUND", channel: "PLATFORM", source: "vrbo", isRead: false },
      { id: "msg-8", reservationId: "res-7", body: "Hi Anna! The nearest Migros supermarket is 800m away, about 10 min walk. There's also a smaller shop 5 min away. Enjoy your stay!", direction: "OUTBOUND", channel: "EMAIL", source: "vrbo", isRead: true, isAiGenerated: true, senderId: user.id },
      { id: "msg-9", reservationId: "res-9", body: "We are celebrating our anniversary. Any recommendations for restaurants nearby?", direction: "INBOUND", channel: "PLATFORM", source: "direct", isRead: false },
      { id: "msg-10", reservationId: "res-12", body: "The air conditioning in the bedroom doesn't seem to work. Can someone help?", direction: "INBOUND", channel: "PLATFORM", source: "booking", isRead: false },
    ],
  });

  // Channel configs for properties
  await Promise.all([
    prisma.channelConfig.upsert({ where: { propertyId_channel: { propertyId: "prop-1", channel: "AIRBNB" } }, update: {}, create: { propertyId: "prop-1", channel: "AIRBNB", icalUrl: "https://www.airbnb.com/calendar/ical/12345678.ics", listingId: "12345678", isActive: true } }),
    prisma.channelConfig.upsert({ where: { propertyId_channel: { propertyId: "prop-1", channel: "BOOKING" } }, update: {}, create: { propertyId: "prop-1", channel: "BOOKING", icalUrl: "https://ical.booking.com/v1/export?t=abc123", listingId: "87654321", isActive: true } }),
    prisma.channelConfig.upsert({ where: { propertyId_channel: { propertyId: "prop-2", channel: "AIRBNB" } }, update: {}, create: { propertyId: "prop-2", channel: "AIRBNB", icalUrl: "https://www.airbnb.com/calendar/ical/99887766.ics", listingId: "99887766", isActive: true } }),
    prisma.channelConfig.upsert({ where: { propertyId_channel: { propertyId: "prop-3", channel: "VRBO" } }, update: {}, create: { propertyId: "prop-3", channel: "VRBO", icalUrl: "https://www.vrbo.com/icalendar/b4c5d6e7f8.ics", listingId: "445566", isActive: true } }),
  ]);

  // Calendar blocks
  await Promise.all([
    prisma.calendarBlock.upsert({ where: { id: "block-1" }, update: {}, create: { id: "block-1", propertyId: "prop-1", startDate: d(15), endDate: d(18), reason: "Owner use" } }),
    prisma.calendarBlock.upsert({ where: { id: "block-2" }, update: {}, create: { id: "block-2", propertyId: "prop-2", startDate: d(60), endDate: d(65), reason: "Maintenance" } }),
  ]);

  // Extra pricing rules
  await Promise.all([
    prisma.pricingRule.upsert({ where: { id: "rule-3" }, update: {}, create: { id: "rule-3", propertyId: "prop-2", name: "Weekend Surcharge", ruleType: "WEEKEND", daysOfWeek: JSON.stringify([5, 6]), adjustment: 15, adjType: "PERCENT", priority: 10 } }),
    prisma.pricingRule.upsert({ where: { id: "rule-4" }, update: {}, create: { id: "rule-4", propertyId: "prop-3", name: "High Season", ruleType: "SEASONAL", startDate: new Date(`${today.getFullYear()}-07-01`), endDate: new Date(`${today.getFullYear()}-08-31`), adjustment: 40, adjType: "PERCENT", minNights: 7, priority: 20 } }),
    prisma.pricingRule.upsert({ where: { id: "rule-5" }, update: {}, create: { id: "rule-5", propertyId: "prop-1", name: "Last Minute Discount", ruleType: "LAST_MINUTE", adjustment: -10, adjType: "PERCENT", priority: 5 } }),
  ]);

  return NextResponse.json({
    message: "Sample data loaded successfully!",
    added: {
      guests: 6,
      reservations: 8,
      messages: 7,
      channelConfigs: 4,
      calendarBlocks: 2,
      pricingRules: 3,
    },
  });
}
