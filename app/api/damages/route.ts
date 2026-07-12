import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — list damage reports (optionally by status)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const reports = await prisma.damageReport.findMany({
    where: {
      property: { ownerId: session.user.id },
      ...(status ? { status } : {}),
    },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(reports);
}

// POST — report a damage (from a cleaning task or standalone)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { propertyId, cleaningTaskId, description, photos } = await req.json();
  if (!propertyId || !description) {
    return NextResponse.json({ error: "propertyId and description are required" }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const report = await prisma.damageReport.create({
    data: {
      propertyId,
      cleaningTaskId: cleaningTaskId || null,
      description,
      photos: JSON.stringify(photos || []),
    },
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(report, { status: 201 });
}

// PATCH — resolve / reopen a report
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status } = await req.json();
  const report = await prisma.damageReport.findFirst({
    where: { id, property: { ownerId: session.user.id } },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.damageReport.update({
    where: { id },
    data: {
      status,
      resolvedAt: status === "RESOLVED" ? new Date() : null,
    },
  });

  return NextResponse.json(updated);
}
