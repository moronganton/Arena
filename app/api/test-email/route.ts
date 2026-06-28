import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function GET() {
  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER,
    from: process.env.SMTP_FROM,
    passSet: !!process.env.SMTP_PASS,
  };

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.SMTP_USER,
      subject: "StayHQ — Email Test",
      html: `<h2>Email is working!</h2><p>Your SMTP configuration is set up correctly. PIN code emails will be delivered to guests.</p><p><small>Sent at ${new Date().toISOString()}</small></p>`,
    });

    return NextResponse.json({ success: true, message: `Test email sent to ${process.env.SMTP_USER}`, config });
  } catch (error: unknown) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      config,
    }, { status: 500 });
  }
}
