import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enqueueAriUpdate } from "@/lib/channels/ari-outbox";
import { groupContiguousDates } from "@/lib/date-ranges";
import { MANUAL_OVERRIDE_PRIORITY } from "@/lib/channels/rate-materializer";

// Manual per-date price overrides made on the calendar grid - writing into
// the same PricingRule table the rule-list page (/pricing) uses, just entered
// by clicking dates instead of a form. Distinguished from every other rule by
// a "[manual]" name prefix, the same convention seed-realistic-rates.ts
// already uses, so the two never collide and re-editing the same exact range
// replaces its own prior override instead of piling up duplicates.
//
// The priority comes from MANUAL_OVERRIDE_PRIORITY in the materializer - the
// single definition of "the manual layer". Above it, resolveMinStay lets an
// override REPLACE the min-stay merge instead of joining the max(), which is
// what makes lowering a minimum from the calendar possible at all.
//
// Two accepted shapes:
//   { startDate, endDate, ... }  - one inclusive range (the original contract)
//   { dates: ["YYYY-MM-DD",...] } - hand-picked dates; adjacent picks are
//     grouped into contiguous ranges first, so all the Saturdays of a month
//     become one small rule per weekend rather than thirty one-day rules.
const MANUAL_PREFIX = "[manual]";

const bodySchema = z
  .object({
    propertyId: z.string(),
    price: z.number().min(0),
    minNights: z.number().int().min(1).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(), // inclusive, same convention as PricingRule
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(366).optional(),
  })
  .refine((b) => b.dates !== undefined || (b.startDate !== undefined && b.endDate !== undefined), {
    message: "provide either dates[] or startDate+endDate",
  });

async function upsertManualRule(
  propertyId: string,
  startYmd: string,
  endYmd: string,
  price: number,
  minNights: number | undefined
) {
  const startDate = new Date(`${startYmd}T00:00:00.000Z`);
  const endDate = new Date(`${endYmd}T00:00:00.000Z`);

  // Re-editing the exact same range updates that rule instead of stacking a
  // second one on top of it at the same priority.
  const existing = await prisma.pricingRule.findFirst({
    where: { propertyId, name: { startsWith: MANUAL_PREFIX }, startDate, endDate },
  });

  return existing
    ? prisma.pricingRule.update({
        where: { id: existing.id },
        data: { price, minNights: minNights ?? existing.minNights, active: true },
      })
    : prisma.pricingRule.create({
        data: {
          propertyId,
          name: `${MANUAL_PREFIX} ${startYmd} to ${endYmd}`,
          ruleType: "SEASONAL",
          startDate,
          endDate,
          price,
          minNights: minNights ?? 1,
          priority: MANUAL_OVERRIDE_PRIORITY,
          active: true,
        },
      });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { propertyId, price, minNights } = parsed.data;

  const property = await prisma.property.findFirst({ where: { id: propertyId, ownerId: session!.user!.id } });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json(
      {
        error:
          property.channelProvider === "SMOOBU"
            ? `${property.name}'s prices come from PriceLabs via Smoobu, not StayHQ's rule engine - nothing to override here`
            : `${property.name} isn't on Channex`,
      },
      { status: 400 }
    );
  }

  const ranges = parsed.data.dates
    ? groupContiguousDates(parsed.data.dates)
    : [{ start: parsed.data.startDate!, end: parsed.data.endDate! }];

  const rules = [];
  for (const r of ranges) {
    rules.push(await upsertManualRule(propertyId, r.start, r.end, price, minNights));
  }

  // One push spanning the whole selection. Days between picked ranges get
  // re-pushed with unchanged truth, which is safe by construction - every
  // push sends the full resolved state per date - and the outbox coalesces
  // overlapping spans anyway.
  const spanFrom = new Date(`${ranges[0].start}T00:00:00.000Z`);
  // endDate is inclusive on PricingRule; the push range is exclusive, same
  // +1 day convention ruleRange() uses in app/api/pricing/route.ts.
  const spanTo = new Date(new Date(`${ranges[ranges.length - 1].end}T00:00:00.000Z`).getTime() + 86400000);
  await enqueueAriUpdate(propertyId, spanFrom, spanTo, "RATE");
  await enqueueAriUpdate(propertyId, spanFrom, spanTo, "RESTRICTION");

  return NextResponse.json({ rules, ranges }, { status: 201 });
}
