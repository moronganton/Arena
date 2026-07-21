import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncUserSmoobuMessages } from "@/lib/channels/smoobu";

// POST /api/messages/sync — pull the logged-in host's latest Smoobu messages
// (and run new ones through the AI). Called by the Messages tab on load so the
// inbox is fresh the moment it's opened.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncUserSmoobuMessages(session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 502 });
  }
}
