import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getChannelState } from "@/lib/channels/channel-state";

// Channel state for the Channels settings page. The shape itself lives in
// lib/channels/channel-state.ts so the property page, which reads Prisma
// directly as a server component, reports exactly the same thing.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const properties = await getChannelState(session.user.id);
  return NextResponse.json({ properties });
}
