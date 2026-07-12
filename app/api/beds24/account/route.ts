import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { connectBeds24 } from "@/lib/channels/beds24";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.beds24Account.findUnique({
    where: { userId: session.user.id },
    select: { createdAt: true, automationEnabled: true },
  });

  return NextResponse.json({
    connected: !!account,
    connectedAt: account?.createdAt ?? null,
    automationEnabled: account?.automationEnabled ?? false,
  });
}

// PATCH — update settings (automation toggle)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { automationEnabled } = await req.json();
  const account = await prisma.beds24Account.update({
    where: { userId: session.user.id },
    data: { automationEnabled: !!automationEnabled },
  });

  return NextResponse.json({ automationEnabled: account.automationEnabled });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { inviteCode } = await req.json();
  if (!inviteCode) return NextResponse.json({ error: "Invite code is required" }, { status: 400 });

  try {
    await connectBeds24(session.user.id, inviteCode);
    return NextResponse.json({ connected: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Connection failed" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.beds24Account.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ connected: false });
}
