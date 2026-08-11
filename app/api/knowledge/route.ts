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

  // action:"bulk" — import many entries at once from pasted JSON.
  //
  // Exists so real property content (WiFi passwords, bank details, door
  // instructions) can be loaded without ever being written into the repo. The
  // host pastes it in the browser and it goes straight to the database.
  if (body.action === "bulk") {
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return NextResponse.json({ error: "entries must be a non-empty array" }, { status: 400 });
    }
    if (body.entries.length > 100) {
      return NextResponse.json({ error: "Too many entries in one import (max 100)." }, { status: 400 });
    }

    const clean: Array<{ category: string; title: string; content: string }> = [];
    for (const [i, e] of body.entries.entries()) {
      const category = typeof e?.category === "string" ? e.category.trim() : "";
      const title = typeof e?.title === "string" ? e.title.trim() : "";
      const content = typeof e?.content === "string" ? e.content.trim() : "";
      if (!category || !title || !content) {
        return NextResponse.json(
          { error: `Entry ${i + 1} is missing category, title or content.` },
          { status: 400 }
        );
      }
      clean.push({ category, title, content });
    }

    // Re-importing should refresh an entry rather than create a duplicate, so a
    // corrected paste can simply be run again.
    const existing = await prisma.propertyKnowledge.findMany({
      where: { propertyId },
      select: { id: true, category: true, title: true },
    });
    const keyOf = (c: string, t: string) => `${c.toLowerCase()}|||${t.toLowerCase()}`;
    const byKey = new Map(existing.map((e) => [keyOf(e.category, e.title), e.id]));

    let created = 0;
    let updated = 0;
    const startOrder = existing.length;
    for (const [i, e] of clean.entries()) {
      const match = byKey.get(keyOf(e.category, e.title));
      if (match) {
        await prisma.propertyKnowledge.update({
          where: { id: match },
          data: { content: e.content, active: true },
        });
        updated++;
      } else {
        await prisma.propertyKnowledge.create({
          data: { ...e, propertyId, sortOrder: startOrder + i },
        });
        created++;
      }
    }

    return NextResponse.json({ success: true, created, updated });
  }

  // action:"copyFrom" - pull another property's knowledge base into this one.
  //
  // The target is the property being viewed, so there is exactly one
  // destination and no way to fan out onto properties by accident.
  //
  // Entries are copied ACTIVE, unlike copied message templates which arrive
  // paused. That is forced rather than chosen: GET above only returns active
  // entries and there is no UI to switch one on, so an inactive copy would be
  // invisible and unreviewable. The risk that creates is handled the other way
  // round - by never overwriting an existing entry unless explicitly asked. The
  // dangerous case is the target already having a correct "WiFi password" and
  // the copy replacing it with the source property's, which the AI would then
  // tell a real guest (lib/ai.ts feeds every active entry to it).
  if (body.action === "copyFrom") {
    const sourcePropertyId = typeof body.sourcePropertyId === "string" ? body.sourcePropertyId : "";
    if (!sourcePropertyId) {
      return NextResponse.json({ error: "sourcePropertyId required" }, { status: 400 });
    }
    if (sourcePropertyId === propertyId) {
      return NextResponse.json({ error: "Pick a different property to copy from." }, { status: 400 });
    }
    const source = await ownedProperty(session.user.id, sourcePropertyId);
    if (!source) return NextResponse.json({ error: "Source property not found" }, { status: 404 });

    const sourceEntries = await prisma.propertyKnowledge.findMany({
      where: { propertyId: sourcePropertyId, active: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (sourceEntries.length === 0) {
      return NextResponse.json({ error: `${source.name} has no knowledge entries to copy.` }, { status: 400 });
    }

    const existing = await prisma.propertyKnowledge.findMany({
      where: { propertyId },
      select: { id: true, category: true, title: true },
    });
    const keyOf = (c: string, t: string) => `${c.toLowerCase()}|||${t.toLowerCase()}`;
    const byKey = new Map(existing.map((e) => [keyOf(e.category, e.title), e.id]));

    const overwrite = body.overwrite === true;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let order = existing.length;

    for (const e of sourceEntries) {
      const match = byKey.get(keyOf(e.category, e.title));
      if (match) {
        if (!overwrite) { skipped++; continue; }
        await prisma.propertyKnowledge.update({
          where: { id: match },
          data: { content: e.content, active: true },
        });
        updated++;
        continue;
      }
      await prisma.propertyKnowledge.create({
        data: {
          propertyId,
          category: e.category,
          title: e.title,
          content: e.content,
          sortOrder: order++,
        },
      });
      created++;
    }

    return NextResponse.json({ success: true, created, updated, skipped, from: source.name });
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
