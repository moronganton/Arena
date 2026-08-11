import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST { id, targets: string[] } - copies one template onto other properties.
//
// A target is either a propertyId or the sentinel "GLOBAL", which means the
// all-properties scope (propertyId = null), matching the filter convention the
// templates page already uses.
//
// Copies are created PAUSED, deliberately. A template body routinely carries
// hard-coded property specifics that no merge field covers - the WiFi password,
// parking directions, the door-entry description, an IBAN. Copied verbatim to a
// different apartment those become confidently wrong instructions, so the copy
// must not be able to reach a real guest before the host has read it. Same
// reasoning as the translate duplicate.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, targets } = await req.json().catch(() => ({}));
  if (!id || !Array.isArray(targets) || targets.length === 0) {
    return NextResponse.json({ error: "id and at least one target are required" }, { status: 400 });
  }

  const source = await prisma.messageTemplate.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!source) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Normalise and de-duplicate, so ticking the same box twice cannot create two
  // identical templates.
  const wanted = [...new Set(targets.map((t: unknown) => String(t)))];
  const propertyIds = wanted.filter((t) => t !== "GLOBAL");

  // Every named property must actually belong to this host. Without this check a
  // crafted request could plant a template - and therefore automated guest
  // messages - on someone else's property.
  const owned = await prisma.property.findMany({
    where: { id: { in: propertyIds }, ownerId: session.user.id },
    select: { id: true, name: true },
  });
  if (owned.length !== propertyIds.length) {
    return NextResponse.json({ error: "One or more properties were not found" }, { status: 404 });
  }
  const nameFor = new Map(owned.map((p) => [p.id, p.name]));

  const created: Array<{ id: string; name: string; scope: string }> = [];

  for (const target of wanted) {
    const propertyId = target === "GLOBAL" ? null : target;

    // Copying a template onto the scope it already has is a plain duplicate, so
    // it gets "(copy)" to stay tellable apart in the list. Copying to a
    // different property does not: the row already shows the property name, and
    // "Pre-arrival welcome" reading the same for both apartments is the point.
    const name = propertyId === source.propertyId ? `${source.name} (copy)` : source.name;

    const copy = await prisma.messageTemplate.create({
      data: {
        userId: session.user.id,
        name,
        trigger: source.trigger,
        offsetDays: source.offsetDays,
        sendHour: source.sendHour,
        subject: source.subject,
        body: source.body,
        active: false, // review the property specifics, then switch it on
        propertyId,
      },
    });

    created.push({
      id: copy.id,
      name: copy.name,
      scope: propertyId === null ? "All properties" : nameFor.get(propertyId) || "property",
    });
  }

  return NextResponse.json({ created }, { status: 201 });
}
