import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordProblem } from "@/lib/password";
import { sendPasswordResetCode } from "@/lib/notifications";
import {
  createResetCode,
  consumeResetCode,
  sendLimitReached,
  recordSend,
} from "@/lib/password-reset";
import { clearLoginFailures } from "@/lib/login-throttle";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public by necessity — someone who cannot sign in has to be able to reach this.
// That changes the threat model, so three things are deliberate below:
//
//   1. The response NEVER reveals whether an address has an account. Otherwise
//      this becomes a tool for enumerating who is registered.
//   2. Sends are rate limited per address, so it cannot be used to bomb an inbox
//      or burn the Resend quota.
//   3. Codes are single-use, hashed at rest, and expire in 15 minutes.
//
// POST { email }                       → step 1: email a code
// PATCH { email, code, newPassword }   → step 2: set the new password
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const addr = email.toLowerCase().trim();

  // Identical response in every branch below this point.
  const genericOk = NextResponse.json({
    sent: true,
    message: "If that address has an account, a code is on its way.",
  });

  if (sendLimitReached(addr)) {
    console.log(`[reset] no code sent for ${addr}: send limit reached`);
    return genericOk;
  }

  const user = await prisma.user.findUnique({
    where: { email: addr },
    select: { id: true, password: true },
  });

  // No account, or a Google-only account with no password to reset. Both fall
  // through silently — telling the caller either fact would leak it.
  //
  // The reason IS logged server-side though: the generic response is what makes
  // "I requested a reset and no email arrived" impossible to diagnose from the
  // outside, so the answer has to be findable somewhere only we can see.
  if (!user) {
    console.log(`[reset] no code sent for ${addr}: no account with that email`);
    return genericOk;
  }
  if (!user.password) {
    console.log(`[reset] no code sent for ${addr}: account has no password (Google sign-in only)`);
    return genericOk;
  }

  const code = createResetCode(addr);
  recordSend(addr);
  try {
    await sendPasswordResetCode({ to: addr, code });
    console.log(`[reset] code sent to ${addr}`);
  } catch (err) {
    // Logged for us, still generic to the caller. A common cause is the shared
    // onboarding@resend.dev sender, which only delivers to the address the
    // Resend account itself is registered under.
    console.error(`[reset] send FAILED for ${addr}:`, err);
  }

  return genericOk;
}

export async function PATCH(req: NextRequest) {
  const { email, code, newPassword } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof code !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "Email, code and new password are required." }, { status: 400 });
  }

  const addr = email.toLowerCase().trim();

  const problem = passwordProblem(newPassword);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const result = consumeResetCode(addr, code);
  if (!result.ok) {
    const message = {
      none: "No reset is pending for that address — request a new code.",
      expired: "That code has expired — request a new one.",
      mismatch: "That code is not correct.",
      too_many: "Too many incorrect attempts. Request a new code.",
    }[result.reason];
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Only reached with a valid, unexpired, single-use code for this address.
  const user = await prisma.user.findUnique({ where: { email: addr }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "Could not complete the reset." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword) },
  });

  // A successful reset should not leave the account still locked out from the
  // failed attempts that probably prompted it.
  clearLoginFailures(addr);

  console.log(`[reset] password reset completed for user ${user.id}`);
  return NextResponse.json({ success: true });
}
