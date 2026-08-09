import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword, passwordProblem } from "@/lib/password";

// POST { currentPassword, newPassword } — change the signed-in user's password.
//
// Requires the current password even though the session already proves identity:
// a borrowed unlocked laptop should not be enough to lock the real owner out of
// their own account.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
  }

  const problem = passwordProblem(newPassword);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // A Google-only account has no password to change.
  if (!user.password) {
    return NextResponse.json(
      { error: "This account signs in with Google and has no password to change." },
      { status: 400 }
    );
  }

  const { valid } = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword) },
  });

  console.log(`[auth] password changed for user ${user.id}`);
  return NextResponse.json({ success: true });
}
