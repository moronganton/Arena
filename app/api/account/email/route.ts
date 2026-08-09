import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { sendEmailChangeCode } from "@/lib/notifications";
import {
  startEmailChange,
  confirmEmailChange,
  peekEmailChange,
  cancelEmailChange,
} from "@/lib/email-change";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET — is there a pending change, and for which address?
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  return NextResponse.json({
    currentEmail: user?.email ?? null,
    pending: peekEmailChange(session.user.id),
  });
}

// POST { newEmail, currentPassword } — step 1: verify the password, then email a
// confirmation code TO THE NEW ADDRESS. Nothing changes yet.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { newEmail, currentPassword } = await req.json();
  if (typeof newEmail !== "string" || typeof currentPassword !== "string") {
    return NextResponse.json({ error: "New email and current password are required." }, { status: 400 });
  }

  const email = newEmail.toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, password: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (email === user.email.toLowerCase()) {
    return NextResponse.json({ error: "That is already your sign-in email." }, { status: 400 });
  }

  if (!user.password) {
    return NextResponse.json(
      { error: "This account signs in with Google — change the email on the Google account instead." },
      { status: 400 }
    );
  }

  const { valid } = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  // User.email is unique, so a clash would fail at write time anyway — caught
  // here to return something readable instead of a Prisma constraint error.
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) {
    return NextResponse.json({ error: "Another account already uses that email." }, { status: 409 });
  }

  const code = startEmailChange(user.id, email);
  try {
    await sendEmailChangeCode({ to: email, code });
  } catch (err) {
    cancelEmailChange(user.id);
    console.error("[account] failed to send email-change code:", err);
    return NextResponse.json(
      { error: "Could not send the code to that address. Check it is correct and reachable." },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true, newEmail: email });
}

// PATCH { code } — step 2: apply the change once the code proves the new address
// is reachable.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = await req.json();
  if (typeof code !== "string") {
    return NextResponse.json({ error: "Code is required." }, { status: 400 });
  }

  const result = confirmEmailChange(session.user.id, code);
  if (!result.ok) {
    const message = {
      none: "No email change is pending — request a new code.",
      expired: "That code has expired — request a new one.",
      mismatch: "That code is not correct.",
      too_many: "Too many incorrect attempts. Request a new code.",
    }[result.reason];
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      // emailVerified is cleared deliberately: the address was proven reachable
      // by our own code, not through a provider's verification, so claiming it
      // is provider-verified would be wrong.
      data: { email: result.newEmail, emailVerified: null },
    });
  } catch (err) {
    console.error("[account] email change write failed:", err);
    return NextResponse.json({ error: "Could not save the new email — it may now be taken." }, { status: 409 });
  }

  console.log(`[auth] sign-in email changed for user ${session.user.id}`);
  return NextResponse.json({ success: true, newEmail: result.newEmail });
}
