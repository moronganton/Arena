import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";

// Read-only forensic audit: who wrote what, to which property, and when.
//
// Written after unexpected reservations appeared on a live Smoobu property.
// Nothing here writes, updates or deletes - it exists to answer "what
// touched production?" with evidence rather than inference.
//
//   GET /api/debug/audit-production-writes
//   GET /api/debug/audit-production-writes?days=14
//
// Every reservation carries the fingerprint of whatever created it, in its
// externalId. That is the single most useful fact in an incident, because
// each writer uses a shape no other writer produces:
//
//   smoobu-<id>            lib/channels/smoobu.ts      (Smoobu sync)
//   channex-<bk>-<listing> lib/channels/channex-*.ts   (Channex intake)
//   <uid>@airbnb.com etc.  lib/channels/ical.ts        (iCal feed import)
//   plain numeric          lib/channels/booking.ts     (Booking.com API)
//   null                   manual entry / CSV import
//
// Timestamps are returned as raw ISO (UTC). The reservations list renders
// through toLocaleTimeString in a server component, so what a host reads on
// screen is Railway's clock, not their own - which is exactly the sort of
// thing that misleads during an incident.

function classifyWriter(externalId: string | null): string {
  if (!externalId) return "manual or CSV import (no externalId)";
  if (externalId.startsWith("smoobu-")) return "Smoobu sync";
  if (externalId.startsWith("channex-")) return "Channex intake";
  if (/^\d+$/.test(externalId)) return "Booking.com API import";
  return "iCal feed import";
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const days = Math.min(Number(new URL(req.url).searchParams.get("days") || 7), 90);
  const since = new Date(Date.now() - days * 86400000);

  const properties = await prisma.property.findMany({
    where: { ownerId: access.userId },
    select: {
      id: true,
      name: true,
      channelProvider: true,
      channexListing: { select: { channexPropertyId: true } },
      channels: {
        select: { id: true, channel: true, icalUrl: true, listingId: true, isActive: true, lastSyncAt: true },
      },
      _count: { select: { reservations: true } },
    },
    orderBy: { name: "asc" },
  });

  const reservations = await prisma.reservation.findMany({
    where: { property: { ownerId: access.userId } },
    select: {
      id: true,
      externalId: true,
      source: true,
      status: true,
      checkIn: true,
      checkOut: true,
      totalAmount: true,
      createdAt: true,
      propertyId: true,
      guest: { select: { name: true } },
      _count: { select: { accessCodes: true, cleaningTasks: true, messages: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Every property, broken down by which code path created its reservations.
  // A property showing a writer that has no business touching it is the
  // finding this whole endpoint exists to surface.
  const byProperty = properties.map((p) => {
    const mine = reservations.filter((r) => r.propertyId === p.id);
    const writers = new Map<string, { count: number; firstWrite: string; lastWrite: string; sources: Set<string> }>();
    for (const r of mine) {
      const w = classifyWriter(r.externalId);
      const at = r.createdAt.toISOString();
      const cur = writers.get(w);
      if (!cur) writers.set(w, { count: 1, firstWrite: at, lastWrite: at, sources: new Set([r.source]) });
      else {
        cur.count++;
        cur.sources.add(r.source);
        if (at < cur.firstWrite) cur.firstWrite = at;
        if (at > cur.lastWrite) cur.lastWrite = at;
      }
    }

    return {
      property: p.name,
      propertyId: p.id,
      channelProvider: p.channelProvider,
      onChannex: !!p.channexListing,
      reservations: p._count.reservations,
      // A feed whose configured channel disagrees with what the feed
      // actually is - an Airbnb export filed under BOOKING, say - mislabels
      // every reservation it creates.
      calendarFeeds: p.channels.map((c) => ({
        channel: c.channel,
        isActive: c.isActive,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        icalHost: c.icalUrl ? safeHost(c.icalUrl) : null,
        feedLooksLike: c.icalUrl ? guessFeedOrigin(c.icalUrl) : null,
        mismatch: c.icalUrl ? guessFeedOrigin(c.icalUrl) !== c.channel : false,
      })),
      writers: [...writers.entries()].map(([writer, v]) => ({
        writer,
        count: v.count,
        sourcesWritten: [...v.sources],
        firstWrite: v.firstWrite,
        lastWrite: v.lastWrite,
      })),
    };
  });

  // Anything created in the audit window, newest first, with the side
  // effects that came with it. Access codes matter most: an import that
  // creates reservations also programs real door locks.
  const recent = reservations
    .filter((r) => r.createdAt >= since)
    .map((r) => ({
      createdAt: r.createdAt.toISOString(),
      writer: classifyWriter(r.externalId),
      property: properties.find((p) => p.id === r.propertyId)?.name ?? r.propertyId,
      guest: r.guest.name,
      source: r.source,
      status: r.status,
      stay: `${r.checkIn.toISOString().slice(0, 10)} -> ${r.checkOut.toISOString().slice(0, 10)}`,
      amount: r.totalAmount,
      externalId: r.externalId,
      accessCodes: r._count.accessCodes,
      cleaningTasks: r._count.cleaningTasks,
      messages: r._count.messages,
      reservationId: r.id,
    }));

  // Door codes written in the window, whatever created them.
  const codes = await prisma.accessCode.findMany({
    where: { createdAt: { gte: since }, reservation: { property: { ownerId: access.userId } } },
    select: {
      id: true,
      createdAt: true,
      isActive: true,
      ttlockKeyId: true,
      validFrom: true,
      validTo: true,
      lock: { select: { name: true, property: { select: { name: true } } } },
      reservation: { select: { id: true, externalId: true, guest: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // The ARI queue must only ever contain Channex properties. A row for a
  // Smoobu property would mean StayHQ tried to push availability for a
  // listing it does not own.
  const outbox = await prisma.ariOutbox.findMany({
    where: { property: { ownerId: access.userId } },
    select: { id: true, kind: true, status: true, createdAt: true, property: { select: { name: true, channelProvider: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const ariOnNonChannex = outbox.filter((o) => o.property.channelProvider !== "CHANNEX");

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    serverTimezoneOffsetMinutes: new Date().getTimezoneOffset(),
    note:
      "All timestamps are ISO/UTC. The reservations list is a server component, " +
      "so the time shown there is this server's clock, not the browser's.",
    windowDays: days,
    since: since.toISOString(),

    findings: {
      ariQueuedForNonChannexProperty: ariOnNonChannex.length,
      feedsWithChannelMismatch: byProperty.flatMap((p) =>
        p.calendarFeeds.filter((f) => f.mismatch).map((f) => `${p.property}: feed is ${f.feedLooksLike}, filed as ${f.channel}`)
      ),
      propertiesWrittenByMoreThanOneWriter: byProperty
        .filter((p) => p.writers.length > 1)
        .map((p) => `${p.property}: ${p.writers.map((w) => `${w.writer} (${w.count})`).join(", ")}`),
    },

    properties: byProperty,
    reservationsCreatedInWindow: recent,
    accessCodesCreatedInWindow: codes.map((c) => ({
      createdAt: c.createdAt.toISOString(),
      property: c.lock.property.name,
      lock: c.lock.name,
      guest: c.reservation.guest.name,
      externalId: c.reservation.externalId,
      isActive: c.isActive,
      // Null means it was recorded in StayHQ but never accepted by the lock,
      // so no PIN actually reached the door.
      pushedToLock: !!c.ttlockKeyId,
      validFrom: c.validFrom.toISOString(),
      validTo: c.validTo.toISOString(),
    })),
    ariOutboxRecent: outbox.map((o) => ({
      createdAt: o.createdAt.toISOString(),
      property: o.property.name,
      channelProvider: o.property.channelProvider,
      kind: o.kind,
      status: o.status,
    })),
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

// Which OTA a feed actually comes from, read off the URL rather than off the
// label someone chose when adding it.
function guessFeedOrigin(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("airbnb")) return "AIRBNB";
  if (u.includes("booking.com") || u.includes("admin.booking")) return "BOOKING";
  if (u.includes("vrbo") || u.includes("homeaway")) return "VRBO";
  if (u.includes("expedia")) return "EXPEDIA";
  return "UNKNOWN";
}
