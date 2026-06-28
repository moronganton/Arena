import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.SMTP_FROM || "StayHQ <onboarding@resend.dev>";

interface AccessCodeEmailParams {
  guestName: string;
  guestEmail: string;
  propertyName: string;
  code: string;
  validFrom: Date;
  validTo: Date;
}

export async function sendAccessCodeEmail(params: AccessCodeEmailParams): Promise<void> {
  const { guestName, guestEmail, propertyName, code, validFrom, validTo } = params;

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a2e;">Your Access Code for ${propertyName}</h2>
      <p>Dear ${guestName},</p>
      <p>We're looking forward to welcoming you! Here is your access code for ${propertyName}:</p>

      <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="margin: 0; color: #666; font-size: 14px;">Your PIN Code</p>
        <h1 style="margin: 8px 0; color: #1a1a2e; font-size: 48px; letter-spacing: 8px; font-family: monospace;">${code}</h1>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Check-in</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${formatDate(validFrom)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; color: #666;">Check-out</td>
          <td style="padding: 8px; font-weight: bold;">${formatDate(validTo)}</td>
        </tr>
      </table>

      <p style="color: #666; font-size: 14px;">
        This code is valid for the duration of your stay only. Please do not share it with others.
      </p>
      <p>If you have any questions, please don't hesitate to reach out.</p>
      <p>Safe travels!<br/>Your Host</p>
    </body>
    </html>
  `;

  await resend.emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Your access code for ${propertyName} — Check-in ${formatDate(validFrom)}`,
    html,
  });
}

interface MessageNotificationParams {
  guestName: string;
  guestEmail: string;
  propertyName: string;
  messageBody: string;
  reservationId: string;
}

export async function sendMessageToGuest(params: MessageNotificationParams): Promise<void> {
  const { guestName, guestEmail, propertyName, messageBody, reservationId } = params;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a2e;">Message from your host — ${propertyName}</h2>
      <p>Dear ${guestName},</p>
      <div style="background: #f9f9f9; border-left: 4px solid #4f46e5; padding: 16px; margin: 16px 0; border-radius: 4px;">
        ${messageBody.replace(/\n/g, "<br/>")}
      </div>
      <p style="color: #999; font-size: 12px;">Reservation ID: ${reservationId}</p>
    </body>
    </html>
  `;

  await resend.emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Message from your host — ${propertyName}`,
    html,
  });
}
