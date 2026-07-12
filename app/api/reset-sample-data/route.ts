import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One-time reset: wipes reservations/guests/messages/cleaning data and seeds
// fresh sample reservations (checkouts yesterday/today/tomorrow) in
// Bratislava, Oradea and Prague. Properties, locks, TTLock and Beds24
// connections are NOT touched.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const userId = session.user.id;

  // ---------- 1. Wipe old transactional data (owner-scoped) ----------
  const ownerFilter = { property: { ownerId: userId } };
  await prisma.message.deleteMany({ where: { reservation: ownerFilter } });
  await prisma.accessCode.deleteMany({ where: { reservation: ownerFilter } });
  await prisma.damageReport.deleteMany({ where: ownerFilter });
  await prisma.cleaningTask.deleteMany({ where: ownerFilter });
  const deletedReservations = await prisma.reservation.deleteMany({ where: ownerFilter });
  await prisma.calendarBlock.deleteMany({ where: ownerFilter });
  // Guests with no remaining reservations
  const deletedGuests = await prisma.guest.deleteMany({
    where: { reservations: { none: {} } },
  });

  // ---------- 2. Ensure sample properties in the three cities ----------
  const cityData = [
    {
      city: "Bratislava", country: "Slovakia", timezone: "Europe/Bratislava", currency: "EUR",
      properties: [
        { name: "Old Town Studio Bratislava", address: "Michalská 12", bedrooms: 1, bathrooms: 1, maxGuests: 2, basePrice: 85 },
        { name: "Danube View Apartment", address: "Pribinova 8", bedrooms: 2, bathrooms: 1, maxGuests: 4, basePrice: 120 },
        { name: "Castle Hill Loft", address: "Zámocká 3", bedrooms: 1, bathrooms: 1, maxGuests: 3, basePrice: 95 },
      ],
    },
    {
      city: "Oradea", country: "Romania", timezone: "Europe/Bucharest", currency: "RON",
      properties: [
        { name: "Republicii Central Apartment", address: "Strada Republicii 15", bedrooms: 2, bathrooms: 1, maxGuests: 4, basePrice: 280 },
        { name: "Union Square Residence", address: "Piața Unirii 4", bedrooms: 1, bathrooms: 1, maxGuests: 2, basePrice: 220 },
        { name: "Art Nouveau Suite Oradea", address: "Strada Vasile Alecsandri 9", bedrooms: 3, bathrooms: 2, maxGuests: 6, basePrice: 380 },
      ],
    },
    {
      city: "Prague", country: "Czech Republic", timezone: "Europe/Prague", currency: "EUR",
      properties: [
        { name: "Wenceslas Square Apartment", address: "Václavské náměstí 21", bedrooms: 2, bathrooms: 1, maxGuests: 4, basePrice: 110 },
        { name: "Charles Bridge Hideaway", address: "Karlova 8", bedrooms: 1, bathrooms: 1, maxGuests: 2, basePrice: 130 },
        { name: "Vinohrady Family Flat", address: "Vinohradská 45", bedrooms: 3, bathrooms: 2, maxGuests: 6, basePrice: 150 },
      ],
    },
  ];

  const propertiesByCity: Record<string, { id: string; basePrice: number; currency: string }[]> = {};
  let propertiesCreated = 0;

  for (const c of cityData) {
    propertiesByCity[c.city] = [];
    for (const p of c.properties) {
      let prop = await prisma.property.findFirst({
        where: { ownerId: userId, name: p.name },
      });
      if (!prop) {
        prop = await prisma.property.create({
          data: {
            ...p,
            city: c.city,
            country: c.country,
            timezone: c.timezone,
            currency: c.currency,
            ownerId: userId,
            description: `Sample property in ${c.city} for testing.`,
          },
        });
        propertiesCreated++;
      }
      propertiesByCity[c.city].push({ id: prop.id, basePrice: prop.basePrice, currency: prop.currency });
    }
  }

  // ---------- 3. Seed guests ----------
  const guestNames = [
    "Emma Novak", "Lukas Weber", "Sofia Rossi", "Jan Kowalski", "Mia Horvat",
    "Petr Svoboda", "Ana Popescu", "Tomás Varga", "Laura Schmidt", "Marek Tóth",
    "Elena Ionescu", "David Kral", "Julia Nagy", "Adam Novotny", "Ivana Kováč",
    "Martin Dvořák", "Andreea Radu", "Filip Horák", "Katarina Bieliková", "Ondřej Černý",
    "Gabriel Munteanu", "Tereza Marek", "Viktor Baláž", "Alina Dumitrescu", "Pavel Jelínek",
    "Simona Lungu", "Roman Urban", "Nikola Šimek", "Cristian Stan", "Zuzana Poláková",
  ];
  const guests = [];
  for (let i = 0; i < guestNames.length; i++) {
    const email = `${guestNames[i].toLowerCase().replace(/[^a-z]/g, ".")}@example.com`;
    const guest = await prisma.guest.upsert({
      where: { id: `sample-guest-${i}` },
      update: {},
      create: {
        id: `sample-guest-${i}`,
        name: guestNames[i],
        email,
        phone: `+42${(1000000 + i * 13579) % 10000000}`,
      },
    });
    guests.push(guest);
  }

  // ---------- 4. Seed reservations: checkouts yesterday / today / tomorrow ----------
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = (days: number) => new Date(today.getTime() + days * 86400000);

  const sources = ["BOOKING", "AIRBNB", "DIRECT", "VRBO", "BOOKING", "AIRBNB"];
  // 10 per city: 3 checked out yesterday, 4 today, 3 tomorrow
  const checkoutOffsets = [-1, -1, -1, 0, 0, 0, 0, 1, 1, 1];

  let reservationsCreated = 0;
  let guestIdx = 0;

  for (const c of cityData) {
    const props = propertiesByCity[c.city];
    for (let i = 0; i < checkoutOffsets.length; i++) {
      const offset = checkoutOffsets[i];
      const prop = props[i % props.length];
      const nights = 2 + (i % 3); // 2-4 nights
      const checkOut = d(offset);
      const checkIn = d(offset - nights);
      const status = offset < 0 ? "CHECKED_OUT" : "CHECKED_IN";
      const guest = guests[guestIdx % guests.length];
      guestIdx++;

      await prisma.reservation.create({
        data: {
          propertyId: prop.id,
          guestId: guest.id,
          checkIn,
          checkOut,
          adults: 1 + (i % 3),
          children: i % 4 === 0 ? 1 : 0,
          totalAmount: Math.round(prop.basePrice * nights),
          currency: prop.currency,
          source: sources[i % sources.length],
          status,
          confirmationCode: `SMP-${c.city.slice(0, 3).toUpperCase()}-${1000 + i}`,
        },
      });
      reservationsCreated++;
    }
  }

  return NextResponse.json({
    message: "Sample data reset complete!",
    deleted: {
      reservations: deletedReservations.count,
      guests: deletedGuests.count,
    },
    created: {
      properties: propertiesCreated,
      guests: guests.length,
      reservations: reservationsCreated,
      breakdown: "10 per city (Bratislava, Oradea, Prague): 3 checked out yesterday, 4 today, 3 tomorrow",
    },
    note: "Properties, locks, TTLock and Beds24 connections were not touched. Confirmed Beds24 bookings will re-import on the next sync.",
  });
}
