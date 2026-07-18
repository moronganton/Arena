import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STARTER_ENTRIES = [
  { category: "WiFi", title: "WiFi network & password", content: "Network name: ___\nPassword: ___" },
  { category: "Check-in & Check-out", title: "Check-in time", content: "Check-in is from 15:00. Early check-in may be possible on request." },
  { category: "Check-in & Check-out", title: "Check-out time", content: "Check-out is by 11:00. Please leave the keys ___" },
  { category: "Parking", title: "Parking options", content: "___ (e.g. free street parking / paid garage at ___, €__ per day)" },
  { category: "House Rules", title: "House rules", content: "No smoking inside. No parties. Quiet hours after 22:00." },
  { category: "Appliances", title: "Air conditioning / heating", content: "___ (e.g. remote is on the wall next to the TV, press MODE for heat/cool)" },
  { category: "Trash & Recycling", title: "Where to take trash", content: "___ (e.g. bins are in the courtyard, blue = paper, yellow = plastic)" },
  { category: "Local Tips", title: "Restaurants & supermarket", content: "___ (e.g. nearest supermarket is ___ 5 min walk; we recommend ___ for dinner)" },
  { category: "Emergency", title: "Emergency contacts", content: "Host: ___\nEmergency services: 112\nBuilding manager: ___" },
];

async function ownedProperty(userId: string, propertyId: string) {
  return prisma.property.findFirst({ where: { id: propertyId, ownerId: userId } });
}

// GET ?propertyId — knowledge entries for a property
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!(await ownedProperty(session.user.id, propertyId))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const entries = await prisma.propertyKnowledge.findMany({
    where: { propertyId, active: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(entries);
}

// POST — add an entry, or action:"starter" to seed the template
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { propertyId } = body;
  if (!propertyId || !(await ownedProperty(session.user.id, propertyId))) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  if (body.action === "starter") {
    const existing = await prisma.propertyKnowledge.count({ where: { propertyId } });
    if (existing === 0) {
      await prisma.propertyKnowledge.createMany({
        data: STARTER_ENTRIES.map((e, i) => ({ ...e, propertyId, sortOrder: i })),
      });
    }
    return NextResponse.json({ success: true });
  }

  if (!body.category || !body.title || !body.content) {
    return NextResponse.json({ error: "category, title and content required" }, { status: 400 });
  }

  const entry = await prisma.propertyKnowledge.create({
    data: {
      propertyId,
      category: body.category,
      title: body.title,
      content: body.content,
    },
  });
  return NextResponse.json(entry, { status: 201 });
}

// PATCH — edit an entry
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, category, title, content } = await req.json();
  const entry = await prisma.propertyKnowledge.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.propertyKnowledge.update({
    where: { id },
    data: { category, title, content },
  });
  return NextResponse.json(updated);
}

// DELETE ?id
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const entry = await prisma.propertyKnowledge.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.propertyKnowledge.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
