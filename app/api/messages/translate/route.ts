import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { translateToEnglish } from "@/lib/translate";

// POST { messageId } — translates one guest message to English and caches the
// result on Message.translatedBody. A message already translated returns the
// cached text immediately with no API call, so re-opening a thread or
// re-tapping the pill never re-costs anything.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const message = await prisma.message.findFirst({
    where: { id: messageId, reservation: { property: { ownerId: session.user.id } }, direction: "INBOUND" },
  });
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  if (message.translatedBody) {
    return NextResponse.json({ translatedBody: message.translatedBody });
  }

  try {
    const translatedBody = await translateToEnglish(message.body);
    await prisma.message.update({ where: { id: message.id }, data: { translatedBody } });
    return NextResponse.json({ translatedBody });
  } catch (err) {
    console.error(`[translate] translation failed for message ${messageId}:`, err);
    return NextResponse.json({ error: "Translation failed — try again in a moment." }, { status: 502 });
  }
}
