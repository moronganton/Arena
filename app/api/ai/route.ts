import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAutoReply } from "@/lib/ai";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.aiSettings.findUnique({
    where: { userId: session!.user!.id },
    include: { templates: true },
  });

  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  if (body.action === "upsert_settings") {
    const settings = await prisma.aiSettings.upsert({
      where: { userId: session!.user!.id },
      create: {
        userId: session!.user!.id,
        enabled: body.enabled ?? true,
        autoReplyEnabled: body.autoReplyEnabled ?? true,
        confidenceThreshold: body.confidenceThreshold ?? 0.8,
        language: body.language ?? "en",
        customInstructions: body.customInstructions,
      },
      update: {
        enabled: body.enabled,
        autoReplyEnabled: body.autoReplyEnabled,
        confidenceThreshold: body.confidenceThreshold,
        language: body.language,
        customInstructions: body.customInstructions,
      },
    });
    return NextResponse.json(settings);
  }

  if (body.action === "test_reply") {
    const result = await generateAutoReply(
      body.message,
      {
        guestName: body.guestName || "Test Guest",
        propertyName: body.propertyName || "Test Property",
        propertyAddress: body.propertyAddress || "123 Test St",
        checkIn: new Date(body.checkIn || Date.now()),
        checkOut: new Date(body.checkOut || Date.now() + 86400000 * 3),
      },
      body.customInstructions
    );
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
