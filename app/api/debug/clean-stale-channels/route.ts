import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// Removes ChannelConfig rows that no longer describe anything real.
//
// Two kinds accumulated:
//
//   - A manager mapping left behind by a property that has since moved to
//     Channex. Sinteu kept a Beds24 row after its migration, so its page
//     reported Beds24 as the connected channel while Channex actually held
//     the listing and twenty live reservations.
//   - OTA rows carrying neither a listing id nor an iCal URL, from the era
//     when connecting a channel meant creating the row first and filling in
//     the feed later. They render as connected channels and mean nothing.
//
// The root cause of the first is fixed in migrate-to-channex, which now
// clears every manager mapping rather than only Smoobu's. This clears what
// was stranded before that.
//
//   GET /api/debug/clean-stale-channels            -> dry run
//   GET /api/debug/clean-stale-channels?confirm=true -> deletes
const MANAGER_CHANNELS = ["SMOOBU", "BEDS24"];

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const configs = await prisma.channelConfig.findMany({
    where: { property: { ownerId: userId } },
    include: { property: { select: { name: true, channelProvider: true } } },
  });

  const plan = configs.map((c) => {
    let reason: string | null = null;
    if (MANAGER_CHANNELS.includes(c.channel) && c.property.channelProvider === "CHANNEX") {
      reason = `${c.channel} mapping left behind - this property is managed by Channex now`;
    } else if (!MANAGER_CHANNELS.includes(c.channel) && !c.listingId && !c.icalUrl) {
      reason = "OTA row with no listing id and no iCal feed - nothing to sync";
    }
    return {
      id: c.id,
      property: c.property.name,
      channel: c.channel,
      listingId: c.listingId,
      hasIcal: !!c.icalUrl,
      action: reason ? "delete" : "keep",
      reason,
    };
  });

  const toDelete = plan.filter((p) => p.action === "delete");

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing deleted",
      total: plan.length,
      toDelete: toDelete.length,
      plan,
    });
  }

  const { count } = await prisma.channelConfig.deleteMany({
    where: { id: { in: toDelete.map((p) => p.id) } },
  });

  return NextResponse.json({ applied: true, deleted: count, deletedRows: toDelete });
}
