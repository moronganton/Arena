import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// The session, or a redirect to the login page. For server COMPONENTS only -
// an API route must return a 401 rather than redirect, so it calls auth()
// directly.
//
// Why this exists rather than each page asserting session!.user.id:
//
// The dashboard layout already does `if (!session) redirect("/login")`, which
// looks like it protects every page beneath it. It does not. In the App
// Router a layout and its page render CONCURRENTLY - the layout's redirect
// does not stop the page's data fetching from starting. So a page reading
// session!.user.id threw "Cannot read properties of null (reading 'user')" on
// every unauthenticated request: a crawler, an expired cookie, a tab left
// open overnight.
//
// That threw where it was caught by instrumentation.ts, which turned each one
// into a push notification. A guard that reads as belt-and-braces was in fact
// the only guard, and its absence was paging a phone.
//
// Returning a narrowed type is the point: with this, `session.user.id` needs
// no assertion, so the next page written cannot quietly reintroduce the bug by
// reaching for `!` to make the compiler stop complaining.
export async function requireSession(): Promise<{ user: { id: string; email?: string | null; name?: string | null } }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session as { user: { id: string; email?: string | null; name?: string | null } };
}
