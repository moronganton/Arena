import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncBookingReservations } from "@/lib/channels/booking";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await req.json();
  if (!channelId) return NextResponse.json({ error: "channelId is required" }, { status: 400 });

  try {
    const result = await syncBookingReservations(channelId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
