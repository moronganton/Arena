import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = "StayHQ <onboarding@resend.dev>";

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

  await getResend().emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Your access code for ${propertyName} — Check-in ${formatDate(validFrom)}`,
    html,
  });
}

interface DatesChangedEmailParams {
  guestName: string;
  guestEmail: string;
  propertyName: string;
  checkIn: Date;
  checkOut: Date;
  accessCode?: string;
}

export async function sendDatesChangedEmail(params: DatesChangedEmailParams): Promise<void> {
  const { guestName, guestEmail, propertyName, checkIn, checkOut, accessCode } = params;

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a2e;">Your stay dates have been updated — ${propertyName}</h2>
      <p>Dear ${guestName},</p>
      <p>The dates of your reservation at <strong>${propertyName}</strong> have changed. Here are your updated details:</p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">New check-in</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${formatDate(checkIn)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; color: #666;">New check-out</td>
          <td style="padding: 8px; font-weight: bold;">${formatDate(checkOut)}</td>
        </tr>
      </table>

      ${accessCode ? `
      <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="margin: 0; color: #666; font-size: 14px;">Your PIN code stays the same</p>
        <h1 style="margin: 8px 0; color: #1a1a2e; font-size: 48px; letter-spacing: 8px; font-family: monospace;">${accessCode}</h1>
        <p style="margin: 0; color: #666; font-size: 13px;">It is now valid for your new dates.</p>
      </div>
      ` : ""}

      <p>If you have any questions about this change, please don't hesitate to reach out.</p>
      <p>Safe travels!<br/>Your Host</p>
    </body>
    </html>
  `;

  await getResend().emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Updated stay dates — ${propertyName} (check-in ${formatDate(checkIn)})`,
    html,
  });
}

interface CancellationEmailParams {
  guestName: string;
  guestEmail: string;
  propertyName: string;
  checkIn: Date;
  checkOut: Date;
  hadAccessCode: boolean;
}

export async function sendCancellationEmail(params: CancellationEmailParams): Promise<void> {
  const { guestName, guestEmail, propertyName, checkIn, checkOut, hadAccessCode } = params;

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a2e;">Reservation Cancelled — ${propertyName}</h2>
      <p>Dear ${guestName},</p>
      <p>Your reservation at <strong>${propertyName}</strong> has been cancelled:</p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Check-in</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${formatDate(checkIn)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; color: #666;">Check-out</td>
          <td style="padding: 8px; font-weight: bold;">${formatDate(checkOut)}</td>
        </tr>
      </table>

      ${hadAccessCode ? `<p style="color: #666; font-size: 14px;">Any door access codes issued for this stay have been deactivated.</p>` : ""}
      <p>If this was a mistake or you have any questions, please contact us.</p>
      <p>Best regards,<br/>Your Host</p>
    </body>
    </html>
  `;

  await getResend().emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Reservation cancelled — ${propertyName}`,
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

  await getResend().emails.send({
    from: FROM,
    to: guestEmail,
    subject: `Message from your host — ${propertyName}`,
    html,
  });
}
