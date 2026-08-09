import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// The seed account's credentials come from the environment, never from source.
// This file previously hardcoded demo123 — and because it upserts on a fixed
// email, running it after the real account was renamed would have created a
// SECOND plaintext admin account rather than updating anything. Both problems
// are closed by refusing to run without an explicit password.
const SEED_EMAIL = process.env.SEED_EMAIL;
const SEED_PASSWORD = process.env.SEED_PASSWORD;

async function main() {
  if (!SEED_EMAIL || !SEED_PASSWORD) {
    console.error(
      "Refusing to seed: set SEED_EMAIL and SEED_PASSWORD first.\n" +
      "  SEED_EMAIL=you@example.com SEED_PASSWORD='a long passphrase' npm run db:seed"
    );
    process.exit(1);
  }
  if (SEED_PASSWORD.length < 10) {
    console.error("Refusing to seed: SEED_PASSWORD must be at least 10 characters.");
    process.exit(1);
  }

  console.log("Seeding demo data...");

  // Seed user — password is hashed, matching how the app stores it.
  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      name: "Demo Host",
      password: await bcrypt.hash(SEED_PASSWORD, 12),
    },
  });

  // Create properties
  const villa = await prisma.property.upsert({
    where: { id: "prop-1" },
    update: {},
    create: {
      id: "prop-1",
      name: "Villa Bella Vista",
      address: "Calle del Mar 42",
      city: "Barcelona",
      country: "Spain",
      description: "Stunning villa with sea views, private pool and garden. 5 minutes from the beach.",
      bedrooms: 3,
      bathrooms: 2,
      maxGuests: 6,
      basePrice: 280,
      currency: "EUR",
      timezone: "Europe/Madrid",
      ownerId: user.id,
    },
  });

  const apartment = await prisma.property.upsert({
    where: { id: "prop-2" },
    update: {},
    create: {
      id: "prop-2",
      name: "Loft Central Lisboa",
      address: "Rua Augusta 156, 3º Dto",
      city: "Lisbon",
      country: "Portugal",
      description: "Stylish loft in the heart of Baixa, perfect for couples.",
      bedrooms: 1,
      bathrooms: 1,
      maxGuests: 2,
      basePrice: 120,
      currency: "EUR",
      timezone: "Europe/Lisbon",
      ownerId: user.id,
    },
  });

  const cottage = await prisma.property.upsert({
    where: { id: "prop-3" },
    update: {},
    create: {
      id: "prop-3",
      name: "Lakeside Cottage",
      address: "23 Lakeview Drive",
      city: "Interlaken",
      country: "Switzerland",
      description: "Cozy cottage with breathtaking mountain lake views.",
      bedrooms: 2,
      bathrooms: 1,
      maxGuests: 4,
      basePrice: 350,
      currency: "CHF",
      timezone: "Europe/Zurich",
      ownerId: user.id,
    },
  });

  // Create guests
  const guests = await Promise.all([
    prisma.guest.upsert({
      where: { id: "guest-1" },
      update: {},
      create: {
        id: "guest-1",
        name: "Sophie Laurent",
        email: "sophie@example.com",
        phone: "+33 6 12 34 56 78",
        language: "fr",
      },
    }),
    prisma.guest.upsert({
      where: { id: "guest-2" },
      update: {},
      create: {
        id: "guest-2",
        name: "Marcus Johnson",
        email: "marcus@example.com",
        phone: "+1 555 987 6543",
        language: "en",
      },
    }),
    prisma.guest.upsert({
      where: { id: "guest-3" },
      update: {},
      create: {
        id: "guest-3",
        name: "Elena Rossi",
        email: "elena@example.com",
        phone: "+39 333 456 7890",
        language: "it",
      },
    }),
    prisma.guest.upsert({
      where: { id: "guest-4" },
      update: {},
      create: {
        id: "guest-4",
        name: "Thomas Müller",
        email: "thomas@example.com",
        language: "de",
      },
    }),
  ]);

  const today = new Date();
  const d = (days: number) => new Date(today.getTime() + days * 86400000);

  // Create reservations
  const reservations = await Promise.all([
    prisma.reservation.upsert({
      where: { id: "res-1" },
      update: {},
      create: {
        id: "res-1",
        propertyId: villa.id,
        guestId: guests[0].id,
        checkIn: d(2),
        checkOut: d(9),
        adults: 4,
        children: 0,
        totalAmount: 1960,
        currency: "EUR",
        source: "AIRBNB",
        status: "CONFIRMED",
        confirmationCode: "HM7829341",
      },
    }),
    prisma.reservation.upsert({
      where: { id: "res-2" },
      update: {},
      create: {
        id: "res-2",
        propertyId: apartment.id,
        guestId: guests[1].id,
        checkIn: d(-1),
        checkOut: d(3),
        adults: 2,
        children: 0,
        totalAmount: 480,
        currency: "EUR",
        source: "BOOKING",
        status: "CHECKED_IN",
        confirmationCode: "BK-2847361",
      },
    }),
    prisma.reservation.upsert({
      where: { id: "res-3" },
      update: {},
      create: {
        id: "res-3",
        propertyId: cottage.id,
        guestId: guests[2].id,
        checkIn: d(14),
        checkOut: d(21),
        adults: 2,
        children: 1,
        totalAmount: 2450,
        currency: "CHF",
        source: "VRBO",
        status: "CONFIRMED",
        confirmationCode: "VB-99123",
      },
    }),
    prisma.reservation.upsert({
      where: { id: "res-4" },
      update: {},
      create: {
        id: "res-4",
        propertyId: villa.id,
        guestId: guests[3].id,
        checkIn: d(20),
        checkOut: d(27),
        adults: 3,
        children: 0,
        totalAmount: 1960,
        currency: "EUR",
        source: "DIRECT",
        status: "CONFIRMED",
        confirmationCode: "DIR-2024-05",
      },
    }),
  ]);

  // Add some messages
  await prisma.message.upsert({
    where: { id: "msg-1" },
    update: {},
    create: {
      id: "msg-1",
      reservationId: "res-1",
      body: "Hello! I'm arriving late around 10pm. Is that okay? Also what is the WiFi password?",
      direction: "INBOUND",
      channel: "PLATFORM",
      source: "airbnb",
      isRead: false,
    },
  });

  await prisma.message.upsert({
    where: { id: "msg-2" },
    update: {},
    create: {
      id: "msg-2",
      reservationId: "res-2",
      body: "Hi Marcus! We're so happy to have you. Your access code for the apartment is 847291. The code is valid from check-in to check-out. WiFi: VilaGuest / Pass: Lisboa2024. Enjoy your stay!",
      direction: "OUTBOUND",
      channel: "EMAIL",
      source: "booking",
      isRead: true,
      isAiGenerated: true,
      senderId: user.id,
    },
  });

  await prisma.message.upsert({
    where: { id: "msg-3" },
    update: {},
    create: {
      id: "msg-3",
      reservationId: "res-2",
      body: "Thank you! Is there parking nearby?",
      direction: "INBOUND",
      channel: "PLATFORM",
      source: "booking",
      isRead: true,
    },
  });

  // Create smart locks
  await prisma.smartLock.upsert({
    where: { id: "lock-1" },
    update: {},
    create: {
      id: "lock-1",
      ttlockId: "ttlock-villa-001",
      name: "Front Door",
      batteryLevel: 85,
      lockType: "PIN",
      isActive: true,
      propertyId: villa.id,
    },
  });

  await prisma.smartLock.upsert({
    where: { id: "lock-2" },
    update: {},
    create: {
      id: "lock-2",
      ttlockId: "ttlock-loft-001",
      name: "Main Entrance",
      batteryLevel: 62,
      lockType: "PIN",
      isActive: true,
      propertyId: apartment.id,
    },
  });

  // Create access code for the checked-in guest
  await prisma.accessCode.upsert({
    where: { id: "code-1" },
    update: {},
    create: {
      id: "code-1",
      code: "847291",
      validFrom: reservations[1].checkIn,
      validTo: reservations[1].checkOut,
      lockId: "lock-2",
      reservationId: "res-2",
      sentToGuest: true,
      sentAt: new Date(),
    },
  });

  // Create AI settings
  await prisma.aiSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      enabled: true,
      autoReplyEnabled: true,
      confidenceThreshold: 0.8,
      language: "en",
      customInstructions:
        "- Villa Bella Vista WiFi: VilaGuest | Password: Barcelona2024!\n- Loft Lisboa WiFi: LoftNet | Password: Lisboa2024\n- Check-in time: 3pm. Check-out: 11am.\n- Late check-in (after 9pm): possible with 24h notice, €20 fee\n- Parking: Villa has 2 private spots. Loft: public parking 50m away (paid)\n- No pets, no smoking indoors, no parties\n- Pool hours: 8am to 10pm",
    },
  });

  // Pricing rules
  await prisma.pricingRule.upsert({
    where: { id: "rule-1" },
    update: {},
    create: {
      id: "rule-1",
      propertyId: villa.id,
      name: "Weekend Surcharge",
      ruleType: "WEEKEND",
      daysOfWeek: JSON.stringify([5, 6]),
      adjustment: 20,
      adjType: "PERCENT",
      priority: 10,
    },
  });

  await prisma.pricingRule.upsert({
    where: { id: "rule-2" },
    update: {},
    create: {
      id: "rule-2",
      propertyId: villa.id,
      name: "Summer Season",
      ruleType: "SEASONAL",
      startDate: new Date(`${today.getFullYear()}-06-01`),
      endDate: new Date(`${today.getFullYear()}-08-31`),
      adjustment: 35,
      adjType: "PERCENT",
      minNights: 5,
      priority: 20,
    },
  });

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
