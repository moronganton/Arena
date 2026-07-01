import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
  }

  const userId = session.user.id;

  // Get the user's properties
  const properties = await prisma.property.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
  });

  if (properties.length === 0) {
    return NextResponse.json({ error: "No properties found. Add at least one property first." }, { status: 400 });
  }

  const today = new Date();
  const d = (days: number) => new Date(today.getTime() + days * 86400000);

  // Use available properties, repeating the first if needed
  const p = (i: number) => properties[i % properties.length];

  // Create guests
  const guestData = [
    { name: "Oliver Bennett",     email: "oliver.bennett@example.com",  phone: "+44 7700 900123", language: "en" },
    { name: "Sofia Andersson",    email: "sofia.andersson@example.com", phone: "+46 70 123 45 67", language: "sv" },
    { name: "Diego Fernández",    email: "diego.fernandez@example.com", phone: "+34 612 345 678",  language: "es" },
    { name: "Yuki Tanaka",        email: "yuki.tanaka@example.com",     phone: "+81 90-1234-5678", language: "ja" },
    { name: "Isabelle Moreau",    email: "isabelle.moreau@example.com", phone: "+33 6 23 45 67 89", language: "fr" },
    { name: "Marco Esposito",     email: "marco.esposito@example.com",  phone: "+39 340 123 4567", language: "it" },
    { name: "Hana Novotný",       email: "hana.novotny@example.com",    phone: "+420 777 123 456", language: "cs" },
    { name: "Rajan Patel",        email: "rajan.patel@example.com",     phone: "+91 98765 43210",  language: "en" },
    { name: "Laura Müller",       email: "laura.mueller@example.com",   phone: "+49 151 2345 6789", language: "de" },
    { name: "Noah Christensen",   email: "noah.christensen@example.com",phone: "+45 20 12 34 56",  language: "da" },
  ];

  const guests = await Promise.all(
    guestData.map((g) =>
      prisma.guest.upsert({
        where: { email: g.email } as never,
        update: {},
        create: g,
      })
    )
  );

  // Reservations: past, current, upcoming across properties
  const reservationData = [
    { prop: 0, guest: 0, checkIn: d(-60), checkOut: d(-53), adults: 2, amount: null, currency: "EUR", source: "BOOKING",  status: "CHECKED_OUT", code: "BK-8811223" },
    { prop: 0, guest: 1, checkIn: d(-40), checkOut: d(-35), adults: 1, amount: null, currency: "EUR", source: "AIRBNB",   status: "CHECKED_OUT", code: "HM-3345671" },
    { prop: 0, guest: 2, checkIn: d(-20), checkOut: d(-15), adults: 3, amount: null, currency: "EUR", source: "DIRECT",   status: "CHECKED_OUT", code: "DIR-2026-01" },
    { prop: 0, guest: 3, checkIn: d(-5),  checkOut: d(1),   adults: 2, amount: null, currency: "EUR", source: "BOOKING",  status: "CHECKED_IN",  code: "BK-9922110" },
    { prop: 0, guest: 4, checkIn: d(3),   checkOut: d(8),   adults: 2, amount: null, currency: "EUR", source: "AIRBNB",   status: "CONFIRMED",   code: "HM-5521398" },
    { prop: 0, guest: 5, checkIn: d(12),  checkOut: d(19),  adults: 4, amount: null, currency: "EUR", source: "BOOKING",  status: "CONFIRMED",   code: "BK-1123456" },
    { prop: 0, guest: 6, checkIn: d(25),  checkOut: d(30),  adults: 2, amount: null, currency: "EUR", source: "EXPEDIA",  status: "CONFIRMED",   code: "EX-7712345" },
    { prop: 0, guest: 7, checkIn: d(40),  checkOut: d(47),  adults: 2, amount: null, currency: "EUR", source: "VRBO",     status: "CONFIRMED",   code: "VB-0055678" },
    { prop: 0, guest: 8, checkIn: d(55),  checkOut: d(62),  adults: 3, amount: null, currency: "EUR", source: "DIRECT",   status: "PENDING",     code: "DIR-2026-02" },
    { prop: 0, guest: 9, checkIn: d(70),  checkOut: d(77),  adults: 2, amount: null, currency: "EUR", source: "BOOKING",  status: "CONFIRMED",   code: "BK-3344556" },
    // Second property (if available)
    { prop: 1, guest: 0, checkIn: d(-15), checkOut: d(-10), adults: 2, amount: null, currency: "EUR", source: "AIRBNB",   status: "CHECKED_OUT", code: "HM-8899001" },
    { prop: 1, guest: 2, checkIn: d(5),   checkOut: d(9),   adults: 2, amount: null, currency: "EUR", source: "BOOKING",  status: "CONFIRMED",   code: "BK-2233445" },
    { prop: 1, guest: 4, checkIn: d(20),  checkOut: d(24),  adults: 1, amount: null, currency: "EUR", source: "DIRECT",   status: "CONFIRMED",   code: "DIR-2026-03" },
  ];

  let imported = 0;
  const reservations = [];
  for (const r of reservationData) {
    const prop = p(r.prop);
    const amount = r.amount ?? Math.round(prop.basePrice * (r.checkOut.getTime() - r.checkIn.getTime()) / 86400000);
    const res = await prisma.reservation.create({
      data: {
        propertyId: prop.id,
        guestId: guests[r.guest].id,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        adults: r.adults,
        children: 0,
        totalAmount: amount,
        currency: r.currency,
        source: r.source,
        status: r.status,
        confirmationCode: r.code,
      },
    });
    reservations.push(res);
    imported++;
  }

  // Sample messages on some reservations
  const messageData = [
    { res: 3, body: "Hi! We just checked in. The apartment is beautiful! Quick question — where is the TV remote?", direction: "INBOUND", source: "booking" },
    { res: 4, body: "Hello! What time can we check in? Our flight arrives at 2pm.", direction: "INBOUND", source: "airbnb" },
    { res: 4, body: "Hi Isabelle! Check-in is from 3pm. If you arrive earlier we can store your luggage. See you soon!", direction: "OUTBOUND", source: "airbnb" },
    { res: 5, body: "Good morning! Are bed linens and towels included?", direction: "INBOUND", source: "booking" },
    { res: 5, body: "Yes, all linens and towels are provided and freshly laundered. We also have an extra set in the wardrobe. Enjoy your stay!", direction: "OUTBOUND", source: "booking" },
    { res: 6, body: "Is there a parking space available?", direction: "INBOUND", source: "expedia" },
    { res: 7, body: "We're travelling with a baby. Is there a cot available?", direction: "INBOUND", source: "vrbo" },
    { res: 8, body: "Can we bring our dog? He is very well-behaved!", direction: "INBOUND", source: "direct" },
  ];

  let msgCount = 0;
  for (const m of messageData) {
    if (!reservations[m.res]) continue;
    await prisma.message.create({
      data: {
        reservationId: reservations[m.res].id,
        body: m.body,
        direction: m.direction as "INBOUND" | "OUTBOUND",
        channel: "PLATFORM",
        source: m.source,
        isRead: m.direction === "OUTBOUND",
        isAiGenerated: m.direction === "OUTBOUND",
      },
    });
    msgCount++;
  }

  return NextResponse.json({
    message: "Sample data added successfully!",
    added: {
      guests: guests.length,
      reservations: imported,
      messages: msgCount,
    },
    note: `Data was added to your ${properties.length} propert${properties.length === 1 ? "y" : "ies"}: ${properties.map((p) => p.name).join(", ")}`,
  });
}
