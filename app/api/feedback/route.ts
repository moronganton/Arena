import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — the user's submitted ideas, newest first
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.feedback.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(items);
}

// POST { message, screenshots?: string[] } — submit an idea
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Please describe your idea first" }, { status: 400 });

  const screenshots = Array.isArray(body.screenshots)
    ? body.screenshots.filter((s: unknown) => typeof s === "string" && String(s).startsWith("data:image/")).slice(0, 3)
    : [];

  const item = await prisma.feedback.create({
    data: {
      ownerId: session.user.id,
      message: message.slice(0, 5000),
      screenshots: screenshots.length > 0 ? JSON.stringify(screenshots) : null,
    },
  });

  return NextResponse.json(item, { status: 201 });
}
