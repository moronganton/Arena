import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/ai/health — current state of the Anthropic API behind the AI
// assistant: is it working, when did it last succeed/fail, what was the last
// failure, and how much rate-limit headroom is left. Powers the AI Status panel.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const health = await prisma.aiHealth.findUnique({ where: { userId: session.user.id } });

  if (!health) {
    // No AI call has happened yet on this account
    return NextResponse.json({
      status: "unknown",
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorType: null,
      lastErrorMessage: null,
      reqRemaining: null,
      tokensRemaining: null,
      tokensLimit: null,
      resetAt: null,
    });
  }

  return NextResponse.json({
    status: health.status,
    lastSuccessAt: health.lastSuccessAt,
    lastErrorAt: health.lastErrorAt,
    lastErrorType: health.lastErrorType,
    lastErrorMessage: health.lastErrorMessage,
    reqRemaining: health.reqRemaining,
    tokensRemaining: health.tokensRemaining,
    tokensLimit: health.tokensLimit,
    resetAt: health.resetAt,
  });
}
