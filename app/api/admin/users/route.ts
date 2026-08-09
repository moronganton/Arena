import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isHashed } from "@/lib/password";

// One-time cleanup tool for the accounts created by the deleted /api/add-user*
// routes. Those routes are gone, but deleting a route never deleted the user
// rows they had already created — so manager@stayhq.com and guest@stayhq.com may
// still exist with the plaintext passwords that are published in the repo.
//
// Protected by WEBHOOK_SECRET rather than a login, deliberately: there is no
// role system yet, so a session-gated admin screen would be reachable by the
// very accounts this is meant to remove. Real user management arrives with
// roles in Phase 2; this is a scalpel for right now.
//
//   GET /api/admin/users?secret=...                        → list every account
//   GET /api/admin/users?secret=...&disable=a@b.com,c@d.com → block their login
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const disableParam = searchParams.get("disable");

  if (disableParam) {
    const emails = disableParam
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const results: Array<Record<string, unknown>> = [];
    for (const email of emails) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, _count: { select: { properties: true } } },
      });
      if (!user) {
        results.push({ email, status: "not found — nothing to do" });
        continue;
      }
      // Clearing the password blocks credentials login outright (authorize()
      // rejects any account without one). Chosen over deletion: it is not
      // destructive, cannot cascade into owned data, and is instant.
      await prisma.user.update({ where: { id: user.id }, data: { password: null } });
      // Kill any live session rows for that user as well, so an already
      // signed-in attacker does not simply keep browsing.
      const killed = await prisma.session.deleteMany({ where: { userId: user.id } });
      results.push({
        email: user.email,
        status: "password login disabled",
        sessionsRevoked: killed.count,
        ownsProperties: user._count.properties,
      });
    }

    return NextResponse.json({
      action: "disable",
      results,
      note:
        "These accounts can no longer sign in with a password. The rows are kept " +
        "so nothing they own is touched — remove them properly once user " +
        "management ships with roles.",
    });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      password: true,
      createdAt: true,
      _count: { select: { properties: true, sessions: true } },
    },
  });

  return NextResponse.json({
    total: users.length,
    users: users.map((u) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt.toISOString().slice(0, 10),
      // The security-relevant bit: can this account be signed into, and is its
      // stored password still plaintext?
      canPasswordLogin: !!u.password,
      passwordStorage: !u.password ? "none (login blocked)" : isHashed(u.password) ? "hashed" : "PLAINTEXT",
      ownsProperties: u._count.properties,
      activeSessionRows: u._count.sessions,
    })),
    hint: "Add &disable=email1,email2 to block password login for the accounts you don't recognise.",
  });
}
