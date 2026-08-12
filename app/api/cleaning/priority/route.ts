import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPriorityDays } from "@/lib/cleaning-priority";

// GET ?days=3 — today's (and the next few days') checkouts as actionable
// cleaning jobs, day-grouped and priority-sorted. Creates the underlying
// CleaningTask on the fly for any checkout that doesn't have one yet.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.min(7, Math.max(1, parseInt(searchParams.get("days") || "3", 10) || 3));

  const result = await getPriorityDays(session.user.id, days);
  return NextResponse.json(result);
}
