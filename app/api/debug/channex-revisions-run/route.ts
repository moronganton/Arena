import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { pollChannexRevisions } from "@/lib/channels/channex-revisions";

// Synchronous version of the /api/cron/channex-revisions poller, for seeing
// the result directly instead of digging through Railway logs.
//
//   GET /api/debug/channex-revisions-run
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const result = await pollChannexRevisions();
  return NextResponse.json(result);
}
