import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Access control for /api/debug/* endpoints.
//
// These endpoints originally required a logged-in session, which means only a
// human with a browser can run them. That made every diagnostic a manual
// round trip: deploy, ask the operator to open a URL, wait for the JSON to be
// pasted back. This adds a second, equivalent way in - a shared secret - so
// the same endpoints can be driven by a script or an agent directly.
//
// Session auth still works exactly as before, so existing browser use is
// unaffected. The secret path is only enabled when DEBUG_API_SECRET is set;
// leave it unset and these endpoints behave as they always have.
//
// Deliberately a SEPARATE secret from WEBHOOK_SECRET. That one is handed to
// third parties (cron pingers, Smoobu, Channex webhook config) and lives in
// their dashboards. These endpoints expose guest names, reservations, and
// access-code state, so they must not be reachable by anything holding only a
// webhook credential.
//
// Prefer the header over the query parameter: URLs end up in server access
// logs, proxy logs, and browser history, and a secret in a query string ends
// up there with them.
//
//   x-debug-secret: <secret>        (preferred)
//   ?secret=<secret>                (fallback, for pasting into a browser)
//
// Endpoints scope their queries to one owner, so this resolves a user id too:
// from the session when there is one, otherwise from an explicit ?userId=, or
// from the only User row when the deployment has exactly one (the common case
// here). It refuses to guess when the choice is ambiguous.

export type DebugAccess =
  | { ok: true; userId: string; via: "session" | "secret" }
  | { ok: false; response: NextResponse };

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, and the lengths themselves are
  // not secret, so compare those first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function requireDebugAccess(req: NextRequest): Promise<DebugAccess> {
  const session = await auth();
  if (session?.user?.id) return { ok: true, userId: session.user.id, via: "session" };

  const expected = process.env.DEBUG_API_SECRET;
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Log in first" }, { status: 401 }),
    };
  }

  const { searchParams } = new URL(req.url);
  const provided = req.headers.get("x-debug-secret") ?? searchParams.get("secret");
  if (!provided || !secretsMatch(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Log in first, or supply a valid x-debug-secret" }, { status: 401 }),
    };
  }

  const explicitUserId = searchParams.get("userId");
  if (explicitUserId) {
    const user = await prisma.user.findUnique({ where: { id: explicitUserId }, select: { id: true } });
    if (!user) {
      return { ok: false, response: NextResponse.json({ error: `No user with id ${explicitUserId}` }, { status: 404 }) };
    }
    return { ok: true, userId: user.id, via: "secret" };
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true }, take: 2 });
  if (users.length === 1) return { ok: true, userId: users[0].id, via: "secret" };

  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          users.length === 0
            ? "No users exist in this database"
            : "More than one user exists - pass ?userId=<id> to say which one this request is for",
      },
      { status: 400 }
    ),
  };
}
