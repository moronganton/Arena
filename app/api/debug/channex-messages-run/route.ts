import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const result = await pollChannexMessages();
  return NextResponse.json(result);
}
