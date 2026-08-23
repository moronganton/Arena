import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/templates — the host's templates + their properties (for scoping)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [templates, properties, user] = await Promise.all([
    prisma.messageTemplate.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: { property: { select: { id: true, name: true } }, _count: { select: { sends: true } } },
    }),
    prisma.property.findMany({
      where: { ownerId: session.user.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } }),
  ]);

  // attachments is stored as a JSON string (same convention as
  // Message.attachments) - parsed here so the client only ever deals with a
  // plain array, never a raw JSON blob.
  const templatesOut = templates.map((t) => ({
    ...t,
    attachments: t.attachments ? (JSON.parse(t.attachments) as string[]) : [],
  }));

  return NextResponse.json({ templates: templatesOut, properties, userEmail: user?.email || "" });
}

// POST /api/templates — create a template
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json();
  if (!b.name?.trim() || !b.body?.trim()) {
    return NextResponse.json({ error: "Name and message body are required" }, { status: 400 });
  }

  const template = await prisma.messageTemplate.create({
    data: {
      userId: session.user.id,
      name: b.name.trim(),
      trigger: b.trigger || "MANUAL",
      offsetDays: Number.isFinite(b.offsetDays) ? Math.max(0, Math.min(60, Math.trunc(b.offsetDays))) : 0,
      sendHour: Number.isFinite(b.sendHour) ? Math.max(0, Math.min(23, Math.trunc(b.sendHour))) : 10,
      subject: b.subject?.trim() || "Message from your host",
      body: b.body,
      attachments: Array.isArray(b.attachments) && b.attachments.length > 0 ? JSON.stringify(b.attachments) : null,
      active: b.active !== false,
      propertyId: b.propertyId || null,
    },
  });
  return NextResponse.json(template, { status: 201 });
}

// PATCH /api/templates — update a template (by id)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Ownership check
  const existing = await prisma.messageTemplate.findFirst({ where: { id: b.id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const template = await prisma.messageTemplate.update({
    where: { id: b.id },
    data: {
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.trigger !== undefined ? { trigger: b.trigger } : {}),
      ...(b.offsetDays !== undefined ? { offsetDays: Math.max(0, Math.min(60, Math.trunc(b.offsetDays))) } : {}),
      ...(b.sendHour !== undefined ? { sendHour: Math.max(0, Math.min(23, Math.trunc(b.sendHour))) } : {}),
      ...(b.subject !== undefined ? { subject: String(b.subject).trim() || "Message from your host" } : {}),
      ...(b.body !== undefined ? { body: b.body } : {}),
      ...(b.attachments !== undefined
        ? { attachments: Array.isArray(b.attachments) && b.attachments.length > 0 ? JSON.stringify(b.attachments) : null }
        : {}),
      ...(b.active !== undefined ? { active: !!b.active } : {}),
      ...(b.propertyId !== undefined ? { propertyId: b.propertyId || null } : {}),
    },
  });
  return NextResponse.json(template);
}

// DELETE /api/templates?id=...
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.messageTemplate.deleteMany({ where: { id, userId: session.user.id } });
  return NextResponse.json({ success: true });
}
