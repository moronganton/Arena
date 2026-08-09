import { NextResponse } from "next/server";
import { Resend } from "resend";
import { auth } from "@/lib/auth";

// Diagnostic: sends a test email to confirm delivery is configured. Requires a
// login — left open, it let anyone burn the Resend quota and confirm which
// services are wired up.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ success: false, error: "RESEND_API_KEY is not set in environment variables." }, { status: 500 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      from: "StayHQ <onboarding@resend.dev>",
      to: process.env.SMTP_USER || "test@example.com",
      subject: "StayHQ — Email Test",
      html: `<h2>Email is working! ✅</h2><p>Your email configuration is set up correctly. PIN code emails will be delivered to guests.</p><p><small>Sent at ${new Date().toISOString()}</small></p>`,
    });

    return NextResponse.json({ success: true, message: `Test email sent to ${process.env.SMTP_USER}`, id: result.data?.id });
  } catch (error: unknown) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
