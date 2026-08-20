import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollChannexRevisions } from "@/lib/channels/channex-revisions";

// Synchronous version of the /api/cron/channex-revisions poller, for seeing
// the result directly instead of digging through Railway logs.
//
//   GET /api/debug/channex-revisions-run
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const result = await pollChannexRevisions();
  return NextResponse.json(result);
}
