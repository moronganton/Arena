import { NextResponse } from "next/server";
import { Resend } from "resend";

export async function GET() {
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
