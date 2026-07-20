import { NextResponse } from "next/server";

// GET /api/push/vapid — the public VAPID key the browser needs to subscribe.
// Read at runtime (not inlined at build) so it works on Railway without a
// NEXT_PUBLIC_ rebuild. Returns { key: null } when push isn't configured.
export async function GET() {
  return NextResponse.json({ key: process.env.VAPID_PUBLIC_KEY || null });
}
