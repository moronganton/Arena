import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateICalFeed } from "@/lib/channels/ical";
import { enqueueAriUpdate } from "@/lib/channels/ari-outbox";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format"); // "ical" for iCal export

  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate = to ? new Date(to) : new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0);

  const reservations = await prisma.reservation.findMany({
    where: {
      property: { ownerId: session!.user!.id },
      ...(propertyId ? { propertyId } : {}),
      status: { not: "CANCELLED" },
      OR: [
        { checkIn: { gte: fromDate, lte: toDate } },
        { checkOut: { gte: fromDate, lte: toDate } },
        { AND: [{ checkIn: { lte: fromDate } }, { checkOut: { gte: toDate } }] },
      ],
    },
    include: {
      guest: true,
      property: { select: { id: true, name: true, city: true } },
    },
    orderBy: { checkIn: "asc" },
  });

  const blocks = await prisma.calendarBlock.findMany({
    where: {
      property: { ownerId: session!.user!.id },
      ...(propertyId ? { propertyId } : {}),
      OR: [
        { startDate: { gte: fromDate, lte: toDate } },
        { endDate: { gte: fromDate, lte: toDate } },
      ],
    },
    include: { property: { select: { id: true, name: true } } },
  });

  if (format === "ical") {
    const feed = generateICalFeed(reservations);
    return new NextResponse(feed, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=calendar.ics",
      },
    });
  }

  return NextResponse.json({ reservations, blocks });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { propertyId, startDate, endDate, reason } = await req.json();

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session!.user!.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const block = await prisma.calendarBlock.create({
    data: {
      propertyId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason,
    },
  });

  // Blocked nights just became unavailable - no-op unless the property is
  // on Channex.
  await enqueueAriUpdate(propertyId, block.startDate, block.endDate, "AVAILABILITY");

  return NextResponse.json(block, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  // Clearing by DATE RANGE, because a calendar knows which nights are
  // selected and not which block rows cover them. A range can span several
  // blocks, or part of one, so overlapping blocks are removed and the
  // untouched remainder written back - reopening a Tuesday must not reopen
  // the whole fortnight it sat in.
  const propertyId = searchParams.get("propertyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!id && propertyId && from && to) {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, ownerId: session!.user!.id },
      select: { id: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const start = new Date(from);
    const end = new Date(to);
    const overlapping = await prisma.calendarBlock.findMany({
      where: { propertyId, startDate: { lt: end }, endDate: { gt: start } },
    });

    const keep: { startDate: Date; endDate: Date; reason: string | null }[] = [];
    for (const b of overlapping) {
      if (b.startDate < start) keep.push({ startDate: b.startDate, endDate: start, reason: b.reason });
      if (b.endDate > end) keep.push({ startDate: end, endDate: b.endDate, reason: b.reason });
    }

    await prisma.$transaction([
      prisma.calendarBlock.deleteMany({ where: { id: { in: overlapping.map((b) => b.id) } } }),
      ...keep.map((k) => prisma.calendarBlock.create({ data: { propertyId, ...k } })),
    ]);

    await enqueueAriUpdate(propertyId, start, end, "AVAILABILITY");
    return NextResponse.json({ success: true, cleared: overlapping.length, kept: keep.length });
  }

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const block = await prisma.calendarBlock.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!block) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.calendarBlock.delete({ where: { id } });

  // Removing the block just freed these nights back up - no-op unless the
  // property is on Channex.
  await enqueueAriUpdate(block.propertyId, block.startDate, block.endDate, "AVAILABILITY");

  return NextResponse.json({ success: true });
}
