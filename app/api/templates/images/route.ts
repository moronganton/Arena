import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const templateId = searchParams.get("templateId");

  if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });

  // Verify template belongs to user
  const template = await prisma.messageTemplate.findFirst({
    where: { id: templateId, userId: session.user.id },
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const images = await prisma.templateImage.findMany({
    where: { templateId },
    orderBy: { order: "asc" },
    select: { id: true, fileName: true, size: true, mimeType: true, order: true },
  });

  return NextResponse.json(images);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const imageId = searchParams.get("imageId");

  if (!imageId) return NextResponse.json({ error: "imageId required" }, { status: 400 });

  const image = await prisma.templateImage.findFirst({
    where: { id: imageId, template: { userId: session.user.id } },
  });
  if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  await prisma.templateImage.delete({ where: { id: imageId } });

  return NextResponse.json({ ok: true });
}
