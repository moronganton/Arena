import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH { messageId, needsHostReply } — dismiss or restore the "needs your
// reply" flag on one inbound message, without sending anything. The dashboard
// list and the thread's rose highlight both read this same flag, so flipping
// it here is enough to affect both — no separate "dismissed" state to track.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId, needsHostReply } = await req.json();
  if (!messageId || typeof needsHostReply !== "boolean") {
    return NextResponse.json({ error: "messageId and needsHostReply (boolean) required" }, { status: 400 });
  }

  const message = await prisma.message.findFirst({
    where: { id: messageId, direction: "INBOUND", reservation: { property: { ownerId: session.user.id } } },
    select: { id: true },
  });
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  await prisma.message.update({ where: { id: message.id }, data: { needsHostReply } });

  return NextResponse.json({ success: true, needsHostReply });
}
