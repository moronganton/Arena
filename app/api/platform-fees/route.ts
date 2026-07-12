import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — commission settings per channel
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.platformFeeSetting.findMany({
    where: { ownerId: session.user.id },
  });

  return NextResponse.json(settings);
}

// POST { fees: [{ channel, percent }] } — upsert commission settings
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fees } = await req.json();
  if (!Array.isArray(fees)) return NextResponse.json({ error: "fees array required" }, { status: 400 });

  for (const f of fees) {
    if (!f.channel) continue;
    const percent = Math.max(0, Math.min(50, parseFloat(f.percent) || 0));
    await prisma.platformFeeSetting.upsert({
      where: { ownerId_channel: { ownerId: session.user.id, channel: f.channel } },
      create: { ownerId: session.user.id, channel: f.channel, percent },
      update: { percent },
    });
  }

  const settings = await prisma.platformFeeSetting.findMany({
    where: { ownerId: session.user.id },
  });
  return NextResponse.json(settings);
}
