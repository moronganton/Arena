import { prisma } from "@/lib/prisma";
import { deliverAiMessage } from "@/lib/ai";
import { valuesFromReservation, renderTemplate, type TemplateReservation } from "@/lib/templates";
import { cetHour, cetDayStartUtc, cetDayStartInstant } from "@/lib/cet";
import { resolveCityTaxCardLinkForTemplate } from "@/lib/city-tax";

// Sends every template whose trigger is due for a reservation today. Pulled
// out of app/api/cron/scheduled-messages/route.ts so both that HTTP route and
// scripts/cron/scheduled-messages.ts (the Railway-cron-job equivalent) call
// the same implementation rather than two copies that can drift apart.
//
// Dedupe is enforced by MessageTemplateSend(unique templateId+reservationId),
// so calling this more than once is safe.
const MAX_SENDS_PER_RUN = 300;

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

// Which reservation date the trigger keys off, and the [from, to) window to
// match against it.
//
// checkIn/checkOut hold calendar dates pinned to UTC midnight, so their windows
// are built from `today` (the CET date in that same encoding). createdAt is a
// real timestamp, so it gets a true CET-day instant window instead - mixing the
// two encodings is what would make "booked today" mean the wrong 24 hours.
function resolveTarget(
  trigger: string,
  offsetDays: number,
  today: Date,
  cetDayStart: Date
): { field: "checkIn" | "checkOut" | "createdAt"; from: Date; to: Date } | null {
  const dateWindow = (field: "checkIn" | "checkOut", target: Date) => ({
    field,
    from: target,
    to: addDays(target, 1),
  });
  switch (trigger) {
    case "NEW_RESERVATION":
      return { field: "createdAt", from: cetDayStart, to: addDays(cetDayStart, 1) };
    case "BEFORE_CHECKIN": return dateWindow("checkIn", addDays(today, offsetDays));
    case "CHECKIN_DAY": return dateWindow("checkIn", today);
    case "DURING_STAY": return dateWindow("checkIn", addDays(today, -offsetDays));
    case "BEFORE_CHECKOUT": return dateWindow("checkOut", addDays(today, offsetDays));
    case "CHECKOUT_DAY": return dateWindow("checkOut", today);
    case "AFTER_CHECKOUT": return dateWindow("checkOut", addDays(today, -offsetDays));
    default: return null; // MANUAL or unknown → never auto-send
  }
}

export async function runScheduledMessages(now: Date = new Date()): Promise<{
  ranAt: string;
  cetHour: number;
  cetDate: string;
  templatesChecked: number;
  sent: number;
  results: Array<Record<string, unknown>>;
}> {
  // Everything the host configures is CET/CEST wall-clock: a template set to
  // 10:00 means 10:00 where the properties are, in both winter and summer.
  const today = cetDayStartUtc(now);
  const cetDayStart = cetDayStartInstant(now);
  const hour = cetHour(now);

  const templates = await prisma.messageTemplate.findMany({
    where: { active: true, trigger: { not: "MANUAL" } },
    include: { user: { select: { name: true } } },
  });

  let sent = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const t of templates) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    // Send around the configured hour; booking confirmations go out on the next run.
    if (t.trigger !== "NEW_RESERVATION" && hour < t.sendHour) continue;

    const resolved = resolveTarget(t.trigger, t.offsetDays, today, cetDayStart);
    if (!resolved) continue;
    const { field, from, to } = resolved;

    const reservations = await prisma.reservation.findMany({
      where: {
        status: { not: "CANCELLED" },
        property: { ownerId: t.userId, ...(t.propertyId ? { id: t.propertyId } : {}) },
        [field]: { gte: from, lt: to },
        // A mid-stay message only makes sense while the guest is still there
        ...(t.trigger === "DURING_STAY" ? { checkOut: { gt: now } } : {}),
      },
      include: {
        guest: { select: { name: true } },
        property: { select: { name: true, address: true, cityTaxAutoChargeEnabled: true, cityTaxPerNight: true } },
        accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
      },
      take: 100,
    });
    if (reservations.length === 0) continue;

    // Skip the ones already sent for this template
    const already = await prisma.messageTemplateSend.findMany({
      where: { templateId: t.id, reservationId: { in: reservations.map((r) => r.id) } },
      select: { reservationId: true },
    });
    const doneIds = new Set(already.map((a) => a.reservationId));

    for (const r of reservations) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      if (doneIds.has(r.id)) continue;

      const values = valuesFromReservation(r as unknown as TemplateReservation, t.user.name);
      if (t.body.includes("[City Tax Card Link]")) {
        // NEXTAUTH_URL directly, not resolveAppOrigin - there is no request
        // here (this runs from a cron route and from a standalone script
        // with no HTTP request at all), and NEXTAUTH_URL is exactly what
        // resolveAppOrigin prefers first anyway.
        const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
        if (appUrl) {
          values["[City Tax Card Link]"] = await resolveCityTaxCardLinkForTemplate(r.id, r.property, appUrl);
        }
      }
      const bodyText = renderTemplate(t.body, values).trim();
      if (!bodyText) continue;

      try {
        // Claim the slot first so a concurrent run can't double-send
        await prisma.messageTemplateSend.create({ data: { templateId: t.id, reservationId: r.id } });
      } catch {
        continue; // unique violation → already handled by another run
      }

      try {
        const msg = await prisma.message.create({
          data: {
            body: bodyText,
            direction: "OUTBOUND",
            channel: "PLATFORM",
            isRead: true,
            reservationId: r.id,
            attachments: t.attachments,
          },
        });
        await deliverAiMessage(msg.id); // relays via Smoobu + emails the guest
        sent++;
        results.push({ template: t.name, reservation: r.id, guest: r.guest.name });
      } catch (err) {
        console.error(`[scheduled-messages] template ${t.id} send failed for reservation ${r.id}:`, err);
        // roll back the claim so it can retry next run
        await prisma.messageTemplateSend.deleteMany({ where: { templateId: t.id, reservationId: r.id } }).catch(() => {});
      }
    }
  }

  return {
    ranAt: now.toISOString(),
    cetHour: hour,
    cetDate: today.toISOString().slice(0, 10),
    templatesChecked: templates.length,
    sent,
    results,
  };
}
