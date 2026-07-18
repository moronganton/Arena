import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { connectSmoobu } from "@/lib/channels/smoobu";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({
    where: { userId: session.user.id },
    select: { createdAt: true, automationEnabled: true },
  });

  return NextResponse.json({
    connected: !!account,
    connectedAt: account?.createdAt ?? null,
    automationEnabled: account?.automationEnabled ?? false,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKey } = await req.json();
  if (!apiKey) return NextResponse.json({ error: "API key is required" }, { status: 400 });

  try {
    await connectSmoobu(session.user.id, apiKey);
    return NextResponse.json({ connected: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Connection failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { automationEnabled } = await req.json();
  const account = await prisma.smoobuAccount.update({
    where: { userId: session.user.id },
    data: { automationEnabled: !!automationEnabled },
  });

  return NextResponse.json({ automationEnabled: account.automationEnabled });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.smoobuAccount.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ connected: false });
}
