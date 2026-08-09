import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = "StayHQ <onboarding@resend.dev>";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Email a rendered template to the host's own address — a clean copy of exactly
// what a guest would receive. `labeled` adds a small TEST banner; leave it off
// for a real-looking copy.
export async function sendTemplateCopyEmail(params: { to: string; subject: string; bodyText: string; labeled?: boolean }): Promise<void> {
  const { to, subject, bodyText, labeled } = params;
  const banner = labeled
    ? `<div style="background:#eef2ff; color:#4338ca; font-size:12px; font-weight:bold; padding:9px 12px; border-radius:8px; margin-bottom:16px;">TEST PREVIEW — this is how your guest would see the message</div>`
    : "";
  const html = `
    <!DOCTYPE html><html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${banner}
      <div style="white-space:pre-wrap; color:#1a1a2e; font-size:15px; line-height:1.6;">${escapeHtml(bodyText)}</div>
    </body></html>`;
  await getResend().emails.send({ from: FROM, to, subject: labeled ? `[TEST] ${subject}` : (subject || "Message from your host"), html });
}

// Emails a confirmation code to a NEW address the host wants to sign in with.
// Sent to the new address specifically: receiving it is the proof that the
// address is real and reachable, which is what stops a typo from locking
// someone out of their own account.
export async function sendEmailChangeCode(params: { to: string; code: string }): Promise<void> {
  const { to, code } = params;
  const html = `
    <!DOCTYPE html><html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color:#1a1a2e;">Confirm your new StayHQ sign-in email</h2>
      <p>Enter this code in StayHQ to finish changing your account email to this address:</p>
      <div style="background:#f0f4ff; border-radius:12px; padding:20px; text-align:center; margin:22px 0;">
        <h1 style="margin:0; color:#1a1a2e; font-size:38px; letter-spacing:9px; font-family:monospace;">${escapeHtml(code)}</h1>
      </div>
      <p style="color:#666; font-size:14px;">The code expires in 15 minutes. Until you enter it, your sign-in email is unchanged.</p>
      <p style="color:#666; font-size:14px;">If you did not request this, you can ignore this email.</p>
    </body></html>`;
  await getResend().emails.send({
    from: FROM,
    to,
    subject: "Your StayHQ email confirmation code",
    html,
  });
}

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

interface AiHealthAlertParams {
  ownerEmail: string;
  ownerName?: string | null;
  title: string;
  hint: string;
  errorType: string;
}

// Alert the host that the AI assistant just got blocked by the Anthropic API
// (rate limit hit, out of credits, or bad key) so they can fix it fast. This is
// the "tell me when the credit is close to exhausted" signal — it fires the
// moment a reply is actually blocked, because Anthropic exposes no advance
// "remaining balance" reading to warn on beforehand.
export async function sendAiHealthAlert(params: AiHealthAlertParams): Promise<void> {
  const { ownerEmail, ownerName, title, hint, errorType } = params;

  const consoleLink =
    errorType === "billing"
      ? "https://console.anthropic.com/settings/billing"
      : errorType === "rate_limit"
      ? "https://console.anthropic.com/settings/limits"
      : "https://console.anthropic.com/settings/keys";

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #b91c1c;">⚠️ Your AI assistant is paused — ${title}</h2>
      <p>${ownerName ? `Hi ${ownerName},` : "Hi,"}</p>
      <p>StayHQ just tried to answer a guest and the Anthropic API blocked it. Until this is resolved, guests may not get automatic replies.</p>
      <div style="background: #fef2f2; border-left: 4px solid #b91c1c; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px; font-weight: bold; color: #7f1d1d;">${title}</p>
        <p style="margin: 0; color: #7f1d1d;">${hint}</p>
      </div>
      <p style="margin: 24px 0;">
        <a href="${consoleLink}" style="background: #4f46e5; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Open Anthropic Console</a>
      </p>
      <p style="color: #666; font-size: 13px;">Tip: enabling <strong>auto-reload</strong> in the Anthropic console (Billing → Auto-reload) tops your balance up automatically so credit never runs out mid-conversation.</p>
      <p style="color: #999; font-size: 12px;">Note: this is your Anthropic <strong>API</strong> account (billed per token) — it's separate from any Claude Pro subscription. You'll get at most one of these emails every 30 minutes.</p>
    </body>
    </html>
  `;

  await getResend().emails.send({
    from: FROM,
    to: ownerEmail,
    subject: `⚠️ StayHQ AI paused — ${title}`,
    html,
  });
}
