import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Adds (or refreshes) demo properties + reservations so the calendar looks
// populated for testing. Everything it creates is clearly marked and fully
// removable, and it NEVER touches Smoobu-synced reservations
// (externalId starting with "smoobu-").
//
//   GET /api/sample-data            → add / refresh the sample data
//   GET /api/sample-data?action=remove → remove only the sample data

const SAMPLE_SUFFIX = " (Sample)";
const SAMPLE_CODE = "SAMPLE-";

const SAMPLE_PROPERTIES = [
  { key: "seaside", name: "Seaside Loft" + SAMPLE_SUFFIX, address: "Passeig Marítim 12", city: "Barcelona", country: "Spain", bedrooms: 2, bathrooms: 1, maxGuests: 4, basePrice: 160, currency: "EUR", timezone: "Europe/Madrid" },
  { key: "chalet", name: "Mountain Chalet" + SAMPLE_SUFFIX, address: "Alpenstrasse 7", city: "Interlaken", country: "Switzerland", bedrooms: 3, bathrooms: 2, maxGuests: 6, basePrice: 240, currency: "EUR", timezone: "Europe/Zurich" },
  { key: "city", name: "City Center Flat" + SAMPLE_SUFFIX, address: "Národní 20", city: "Prague", country: "Czech Republic", bedrooms: 1, bathrooms: 1, maxGuests: 2, basePrice: 120, currency: "EUR", timezone: "Europe/Prague" },
];

// [propKey, guestName, source, startOffsetDays, nights]
const SAMPLE_BOOKINGS: [string, string, string, number, number][] = [
  ["seaside", "Emma Novak", "AIRBNB", -2, 5],
  ["seaside", "Liam Fischer", "BOOKING", 5, 4],
  ["seaside", "Chloé Martin", "DIRECT", 12, 3],
  ["seaside", "Noah Bauer", "AIRBNB", 20, 5],
  ["chalet", "Sofia Ricci", "VRBO", 0, 6],
  ["chalet", "Jonas Weber", "BOOKING", 9, 2],
  ["chalet", "Ava Horvat", "AIRBNB", 14, 7],
  ["chalet", "Marek Novak", "DIRECT", 25, 3],
  ["city", "Petr Svoboda", "BOOKING", -1, 3],
  ["city", "Lucia Kováč", "DIRECT", 4, 2],
  ["city", "Tomás Varga", "VRBO", 8, 5],
  ["city", "Elena Popescu", "AIRBNB", 18, 4],
  ["city", "David Král", "BOOKING", 24, 2],
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const userId = session.user.id;
  const action = new URL(req.url).searchParams.get("action");

  return action === "remove" ? removeSample(userId) : addSample(userId);
}

async function addSample(userId: string) {
  // Create the sample properties (once) and map key → id
  const propByKey: Record<string, string> = {};
  for (const sp of SAMPLE_PROPERTIES) {
    let prop = await prisma.property.findFirst({ where: { ownerId: userId, name: sp.name } });
    if (!prop) {
      const { key, ...data } = sp;
      void key;
      prop = await prisma.property.create({
        data: { ...data, ownerId: userId, description: "Sample property for testing — safe to remove.", active: true },
      });
    }
    propByKey[sp.key] = prop.id;
  }

  // Clear any prior SAMPLE- reservations on these properties so re-running
  // gives a fresh set. Never matches Smoobu reservations (different code + externalId).
  const prior = await prisma.reservation.findMany({
    where: { propertyId: { in: Object.values(propByKey) }, confirmationCode: { startsWith: SAMPLE_CODE } },
    select: { id: true },
  });
  const priorIds = prior.map((r) => r.id);
  if (priorIds.length) {
    await prisma.message.deleteMany({ where: { reservationId: { in: priorIds } } });
    await prisma.accessCode.deleteMany({ where: { reservationId: { in: priorIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: priorIds } } });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = (off: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() + off);
    return x;
  };

  let created = 0;
  for (let i = 0; i < SAMPLE_BOOKINGS.length; i++) {
    const [key, guestName, source, off, nights] = SAMPLE_BOOKINGS[i];
    const propertyId = propByKey[key];
    if (!propertyId) continue;

    const guest = await prisma.guest.upsert({
      where: { id: `smpl-guest-${i}` },
      update: { name: guestName },
      create: {
        id: `smpl-guest-${i}`,
        name: guestName,
        email: `${guestName.toLowerCase().replace(/[^a-z]/g, ".")}@example.com`,
      },
    });

    await prisma.reservation.create({
      data: {
        propertyId,
        guestId: guest.id,
        checkIn: d(off),
        checkOut: d(off + nights),
        adults: 2,
        source,
        status: "CONFIRMED",
        currency: "EUR",
        totalAmount: nights * 120,
        confirmationCode: `${SAMPLE_CODE}${i + 1}`,
      },
    });
    created++;
  }

  return NextResponse.json({
    message: "Sample data added. Your Smoobu reservations were not touched.",
    properties: Object.keys(propByKey).length,
    reservations: created,
    tip: "Open the Calendar to see them. To remove later: /api/sample-data?action=remove",
  });
}

async function removeSample(userId: string) {
  const props = await prisma.property.findMany({
    where: { ownerId: userId, name: { endsWith: SAMPLE_SUFFIX } },
    select: { id: true },
  });
  const propIds = props.map((p) => p.id);

  // Delete reservations on sample properties — but hard-guard against ever
  // removing a Smoobu-synced reservation. externalId is NULL for sample rows,
  // and `NOT (NULL LIKE ...)` is NULL (not true) in SQL, so NULLs must be
  // matched explicitly or they'd be skipped.
  const resns = await prisma.reservation.findMany({
    where: {
      propertyId: { in: propIds },
      OR: [{ externalId: null }, { externalId: { not: { startsWith: "smoobu-" } } }],
    },
    select: { id: true },
  });
  const resIds = resns.map((r) => r.id);
  if (resIds.length) {
    await prisma.message.deleteMany({ where: { reservationId: { in: resIds } } });
    await prisma.accessCode.deleteMany({ where: { reservationId: { in: resIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: resIds } } });
  }

  // Delete each sample property only if nothing real remains attached to it
  let removedProps = 0;
  for (const id of propIds) {
    const remaining = await prisma.reservation.count({ where: { propertyId: id } });
    if (remaining > 0) continue; // safety: leave it if any reservation is still linked
    await prisma.channelConfig.deleteMany({ where: { propertyId: id } });
    await prisma.pricingRule.deleteMany({ where: { propertyId: id } });
    await prisma.calendarBlock.deleteMany({ where: { propertyId: id } });
    await prisma.propertyKnowledge.deleteMany({ where: { propertyId: id } });
    await prisma.property.delete({ where: { id } });
    removedProps++;
  }

  const delGuests = await prisma.guest.deleteMany({
    where: { id: { startsWith: "smpl-guest-" }, reservations: { none: {} } },
  });

  return NextResponse.json({
    message: "Sample data removed. Your Smoobu reservations were not touched.",
    removed: { reservations: resIds.length, properties: removedProps, guests: delGuests.count },
  });
}
