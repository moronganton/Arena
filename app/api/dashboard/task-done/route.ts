import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST { kind: "note" | "damage", id } — flag a dashboard task complete.
// note   → an INTERNAL message used as a to-do (taskDone = true)
// damage → a DamageReport (status = RESOLVED)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kind, id } = await req.json();
  if (!id || (kind !== "note" && kind !== "damage")) {
    return NextResponse.json({ error: "kind and id required" }, { status: 400 });
  }

  if (kind === "note") {
    const owned = await prisma.message.findFirst({
      where: { id, channel: "INTERNAL", reservation: { property: { ownerId: session.user.id } } },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.message.update({ where: { id }, data: { taskDone: true } });
  } else {
    const owned = await prisma.damageReport.findFirst({
      where: { id, property: { ownerId: session.user.id } },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.damageReport.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  }

  return NextResponse.json({ success: true });
}
