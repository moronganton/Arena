import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";

// Lists, and optionally removes, calendar-feed rows on properties that are
// owned by a channel manager.
//
// Dry run by default. Nothing is removed unless ?apply=true is passed.
//
//   GET /api/debug/stale-feeds
//   GET /api/debug/stale-feeds?apply=true
//
// A feed on a Smoobu- or Channex-managed property is left over from before
// that manager took the listing over. The importer now refuses to run for
// such a property, so these are inert - but they still appear on the
// Channels page as active connections, which is how one of them came to be
// pressed in the first place. Config that lies about what it does is worth
// removing even once it can no longer act.
//
// Only rows with an icalUrl are considered. The manager's OWN mapping rows
// live in this same table (channel = "SMOOBU") and carry no feed URL - those
// are how the property is connected at all and must never be removed here.

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const apply = new URL(req.url).searchParams.get("apply") === "true";

  const rows = await prisma.channelConfig.findMany({
    where: {
      icalUrl: { not: null },
      property: { ownerId: access.userId, channelProvider: { in: ["SMOOBU", "CHANNEX"] } },
    },
    select: {
      id: true,
      channel: true,
      icalUrl: true,
      isActive: true,
      lastSyncAt: true,
      property: { select: { name: true, channelProvider: true } },
    },
  });

  const plan = rows.map((r) => ({
    id: r.id,
    property: r.property.name,
    managedBy: r.property.channelProvider,
    labelledAs: r.channel,
    // The URL says where the feed really points; the label is just what
    // someone chose when adding it. Where they disagree, every reservation
    // the feed created was mislabelled too.
    feedActuallyFrom: guessFeedOrigin(r.icalUrl!),
    mislabelled: guessFeedOrigin(r.icalUrl!) !== r.channel,
    isActive: r.isActive,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
  }));

  if (!apply) {
    return NextResponse.json({
      mode: "dry run - nothing has been changed",
      wouldRemove: plan.length,
      note: "Manager mapping rows (no icalUrl) are never included - removing those would disconnect the property.",
      hint: "Re-run with &apply=true to remove these.",
      plan,
    });
  }

  const removed: string[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    try {
      await prisma.channelConfig.delete({ where: { id: r.id } });
      removed.push(`${r.property.name}: ${r.channel}`);
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ mode: "applied", removed: removed.length, details: removed, errors });
}

function guessFeedOrigin(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("airbnb")) return "AIRBNB";
  if (u.includes("booking.com") || u.includes("admin.booking")) return "BOOKING";
  if (u.includes("vrbo") || u.includes("homeaway")) return "VRBO";
  if (u.includes("expedia")) return "EXPEDIA";
  return "UNKNOWN";
}
