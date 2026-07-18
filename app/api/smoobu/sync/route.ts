import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncSmoobuBookings } from "@/lib/channels/smoobu";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncSmoobuBookings(session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
