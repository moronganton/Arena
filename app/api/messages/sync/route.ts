import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProvidersForUser } from "@/lib/channels/smoobu-provider";

// POST /api/messages/sync — pull the logged-in host's latest messages from
// every channel manager they use (and run new ones through the AI). Called
// by the Messages tab on load so the inbox is fresh the moment it's opened.
//
// Runs every connected provider, not just Smoobu - a host with properties
// split across providers during migration gets both synced by one call here.
// Today getProvidersForUser only ever returns Smoobu (or nothing, if not
// connected), so the summed result is identical to calling Smoobu directly.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const providers = await getProvidersForUser(session.user.id);
    let checked = 0;
    let newMessages = 0;
    for (const provider of providers) {
      const r = await provider.syncMessages(session.user.id);
      checked += r.checked;
      newMessages += r.newMessages;
    }
    return NextResponse.json({ checked, newMessages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 502 });
  }
}
