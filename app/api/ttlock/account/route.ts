import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { connectTTLockAccount } from "@/lib/ttlock";

// GET — connection status
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.tTLockAccount.findUnique({
    where: { userId: session.user.id },
    select: { username: true, createdAt: true, expiresAt: true },
  });

  return NextResponse.json({
    connected: !!account,
    username: account?.username ?? null,
    connectedAt: account?.createdAt ?? null,
  });
}

// POST — connect a TTLock account (username + password)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  try {
    const account = await connectTTLockAccount(session.user.id, username, password);
    return NextResponse.json({ connected: true, username: account.username });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTLock login failed" },
      { status: 400 }
    );
  }
}

// DELETE — disconnect
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.tTLockAccount.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ connected: false });
}
