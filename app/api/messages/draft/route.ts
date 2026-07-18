import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deliverAiMessage } from "@/lib/ai";

// POST { id, action: "approve" | "discard", body? } — handle an AI draft
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action, body } = await req.json();
  const draft = await prisma.message.findFirst({
    where: { id, isDraft: true, reservation: { property: { ownerId: session.user.id } } },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  if (action === "discard") {
    await prisma.message.delete({ where: { id } });
    return NextResponse.json({ success: true, discarded: true });
  }

  if (action === "approve") {
    const updated = await prisma.message.update({
      where: { id },
      data: {
        isDraft: false,
        // Allow the host to tweak the text before sending
        body: typeof body === "string" && body.trim() ? body.trim() : draft.body,
        senderId: session.user.id,
      },
    });
    await deliverAiMessage(updated.id);
    return NextResponse.json({ success: true, message: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
