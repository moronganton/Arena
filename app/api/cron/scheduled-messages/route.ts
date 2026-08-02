import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverAiMessage } from "@/lib/ai";
import { valuesFromReservation, renderTemplate, type TemplateReservation } from "@/lib/templates";
import { getTemplateImages, appendImageLinks, toEmailAttachments, publicBaseUrl } from "@/lib/template-images";

// Scheduler: call this on a schedule (hourly is ideal) to send any template
// whose trigger is due for a reservation today. Protect it with the same
// WEBHOOK_SECRET you use for the Smoobu webhook.
//   GET /api/cron/scheduled-messages?secret=YOUR_WEBHOOK_SECRET
//
// Set it up on Railway (cron job hitting this URL) or any external cron pinger.
// Dedupe is enforced by MessageTemplateSend(unique templateId+reservationId),
// so calling it more than once is safe.

const MAX_SENDS_PER_RUN = 300;

function dayStartUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

// Which reservation date the trigger keys off, and the target day for "today".
function resolveTarget(trigger: string, offsetDays: number, today: Date): { field: "checkIn" | "checkOut" | "createdAt"; target: Date } | null {
  switch (trigger) {
    case "NEW_RESERVATION": return { field: "createdAt", target: today };
    case "BEFORE_CHECKIN": return { field: "checkIn", target: addDays(today, offsetDays) };
    case "CHECKIN_DAY": return { field: "checkIn", target: today };
    case "DURING_STAY": return { field: "checkIn", target: addDays(today, -offsetDays) };
    case "BEFORE_CHECKOUT": return { field: "checkOut", target: addDays(today, offsetDays) };
    case "CHECKOUT_DAY": return { field: "checkOut", target: today };
    case "AFTER_CHECKOUT": return { field: "checkOut", target: addDays(today, -offsetDays) };
    default: return null; // MANUAL or unknown → never auto-send
  }
}

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const baseUrl = publicBaseUrl();
  const today = dayStartUTC(now);
  const hour = now.getUTCHours();

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

    const resolved = resolveTarget(t.trigger, t.offsetDays, today);
    if (!resolved) continue;
    const { field, target } = resolved;

    const reservations = await prisma.reservation.findMany({
      where: {
        status: { not: "CANCELLED" },
        property: { ownerId: t.userId, ...(t.propertyId ? { id: t.propertyId } : {}) },
        [field]: { gte: target, lt: addDays(target, 1) },
        // A mid-stay message only makes sense while the guest is still there
        ...(t.trigger === "DURING_STAY" ? { checkOut: { gt: now } } : {}),
      },
      include: {
        guest: { select: { name: true } },
        property: { select: { name: true, address: true } },
        accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
      },
      take: 100,
    });
    if (reservations.length === 0) continue;

    // Same photos for every reservation on this template — fetch once per run.
    const images = await getTemplateImages(t.id);
    const emailAttachments = toEmailAttachments(images);

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
      const rendered = renderTemplate(t.body, values).trim();
      if (!rendered) continue; // guard before links, or photos alone would send an empty message
      const bodyText = appendImageLinks(rendered, images, baseUrl);

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
          },
        });
        await deliverAiMessage(msg.id, { attachments: emailAttachments }); // relays via Smoobu + emails the guest
        sent++;
        results.push({ template: t.name, reservation: r.id, guest: r.guest.name });
      } catch (err) {
        console.error(`[cron] template ${t.id} send failed for reservation ${r.id}:`, err);
        // roll back the claim so it can retry next run
        await prisma.messageTemplateSend.deleteMany({ where: { templateId: t.id, reservationId: r.id } }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ranAt: now.toISOString(), templatesChecked: templates.length, sent, results });
}
