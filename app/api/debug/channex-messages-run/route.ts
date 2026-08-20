import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { pollChannexMessages } from "@/lib/channels/channex-messages";

// Synchronous version of the /api/cron/channex-messages poller, for seeing
// the result directly instead of digging through Railway logs.
//
// A run where every reservation lands in `unsupported` is the expected
// outcome on the shared sandbox test hotel - it means the calls are being
// made and answered correctly, and the OTA behind those bookings simply has
// no message API.
//
//   GET /api/debug/channex-messages-run
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const result = await pollChannexMessages();
  return NextResponse.json(result);
}
