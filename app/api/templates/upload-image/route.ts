import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const templateId = formData.get("templateId") as string;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: "No templateId provided" }, { status: 400 });

  // Verify template belongs to user
  const template = await prisma.messageTemplate.findFirst({
    where: { id: templateId, userId: session.user.id },
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Validate file size (max 5MB per image)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  // Validate file type
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedMimes.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 });
  }

  try {
    // Convert file to base64 for storage (for MVP, can switch to S3/CDN later)
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Get current image count to set order
    const currentCount = await prisma.templateImage.count({
      where: { templateId },
    });

    // Store image metadata
    const image = await prisma.templateImage.create({
      data: {
        templateId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        url: dataUrl, // Store data URL directly for now
        order: currentCount,
      },
    });

    return NextResponse.json({
      id: image.id,
      fileName: image.fileName,
      url: image.url,
      order: image.order,
      size: image.size,
    });
  } catch (err) {
    console.error("Image upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
