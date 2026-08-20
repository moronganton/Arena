import ical from "node-ical";
import { prisma } from "@/lib/prisma";
import { generateAccessCode } from "@/lib/ttlock";

export type ICalEvent = {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  description?: string;
  status?: string;
};

export async function parseICalFeed(url: string): Promise<ICalEvent[]> {
  const data = await ical.async.fromURL(url);
  const events: ICalEvent[] = [];

  for (const key of Object.keys(data)) {
    const event = data[key];
    if (event.type !== "VEVENT") continue;

    const start =
      event.start instanceof Date ? event.start : new Date(event.start as string);
    const end =
      event.end instanceof Date ? event.end : new Date(event.end as string);

    events.push({
      uid: event.uid as string,
      summary: (event.summary as string) || "Reservation",
      start,
      end,
      description: event.description as string | undefined,
      status: event.status as string | undefined,
    });
  }

  return events;
}

export async function syncChannelIcal(
  channelConfigId: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  const channel = await prisma.channelConfig.findUnique({
    where: { id: channelConfigId },
    include: { property: { include: { locks: true } } },
  });

  if (!channel || !channel.icalUrl) {
    return { created: 0, updated: 0, errors: ["Channel not found or no iCal URL"] };
  }

  // A property whose connectivity belongs to a channel manager must not also
  // be written by this importer. That is the invariant channelProvider was
  // introduced for - "two managers must never own the same listing at once" -
  // and this path was the one place that never checked it.
  //
  // This is not theoretical. This importer is the pre-Smoobu integration,
  // superseded and dropped from the navigation in July with its stored
  // ChannelConfig rows left behind. When the screen came back, those rows
  // came back with it, and a single click re-imported an entire OTA calendar
  // onto a live Smoobu property as confirmed reservations - each one holding
  // real dates and each one able to program a real door lock.
  //
  // Only a property explicitly on no channel manager may be synced this way.
  if (channel.property.channelProvider !== "NONE") {
    return {
      created: 0,
      updated: 0,
      errors: [
        `${channel.property.name} is managed by ${channel.property.channelProvider}. ` +
          `Calendar-feed import is disabled for it, because that manager already owns its ` +
          `availability and importing again would create duplicate stays.`,
      ],
    };
  }

  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  try {
    const events = await parseICalFeed(channel.icalUrl);

    for (const event of events) {
      const existing = await prisma.reservation.findFirst({
        where: {
          propertyId: channel.propertyId,
          externalId: event.uid,
        },
      });

      // Find or create a placeholder guest for this channel
      let guest = await prisma.guest.findFirst({
        where: { name: event.summary },
      });

      if (!guest) {
        guest = await prisma.guest.create({
          data: {
            name: event.summary,
            notes: event.description,
          },
        });
      }

      const reservationData = {
        checkIn: event.start,
        checkOut: event.end,
        status:
          event.status === "CANCELLED" || event.summary?.toLowerCase().includes("cancel")
            ? "CANCELLED"
            : "CONFIRMED",
        source: channel.channel,
        externalId: event.uid,
        propertyId: channel.propertyId,
        guestId: guest.id,
      };

      if (existing) {
        await prisma.reservation.update({
          where: { id: existing.id },
          data: reservationData,
        });
        updated++;
      } else {
        const newReservation = await prisma.reservation.create({
          data: reservationData,
        });
        created++;

        // Auto-generate TTLock access code for new reservations
        for (const lock of channel.property.locks) {
          if (lock.isActive) {
            try {
              const { lockError } = await generateAccessCode({
                lockId: lock.id,
                reservationId: newReservation.id,
                validFrom: event.start,
                validTo: event.end,
              });
              if (lockError) errors.push(`Lock ${lock.name}: ${lockError}`);
            } catch (err) {
              errors.push(`Failed to generate code for lock ${lock.name}: ${err}`);
            }
          }
        }
      }
    }

    await prisma.channelConfig.update({
      where: { id: channelConfigId },
      data: { lastSyncAt: new Date() },
    });
  } catch (err) {
    errors.push(`iCal sync failed: ${err}`);
  }

  return { created, updated, errors };
}

// Scoped to one owner. It previously selected every active feed in the
// database regardless of who it belonged to, so one host pressing "Sync All"
// reached into every other host's properties. Only one account exists today,
// so nothing came of it, but it is a cross-tenant write and does not survive
// a second customer.
export async function syncAllChannels(ownerId: string): Promise<void> {
  const channels = await prisma.channelConfig.findMany({
    where: { isActive: true, icalUrl: { not: null }, property: { ownerId } },
  });

  await Promise.allSettled(channels.map((c) => syncChannelIcal(c.id)));
}

export function generateICalFeed(
  reservations: Array<{
    id: string;
    checkIn: Date;
    checkOut: Date;
    guest: { name: string };
    confirmationCode?: string | null;
  }>
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PMS App//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const r of reservations) {
    const dtStart = formatICalDate(r.checkIn);
    const dtEnd = formatICalDate(r.checkOut);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${r.id}@pms-app`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${r.guest.name}`);
    if (r.confirmationCode) lines.push(`DESCRIPTION:${r.confirmationCode}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function formatICalDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}
