import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enqueueAriUpdate } from "@/lib/channels/ari-outbox";

// Manual per-range price overrides made by dragging a date range on the
// calendar grid at /pricing/calendar - writing into the same PricingRule
// table the rule-list page (/pricing) uses, just entered by drag-select
// instead of a form. Distinguished from every other rule by a "[manual]"
// name prefix, the same convention seed-realistic-rates.ts already uses for
// its own generated rules, so the two never collide and re-editing the same
// exact range replaces its own prior override instead of piling up
// duplicates that would all apply at the same priority.
//
// Priority 50 is deliberately above the seeded layers (season=10,
// weekend=20, holiday=30, see seed-realistic-rates.ts) so a manual edit from
// the calendar always wins over whatever rule was under it - the same
// "more specific beats more general" contract resolvePrice already
// implements for every other rule.
const MANUAL_PREFIX = "[manual]";
const MANUAL_PRIORITY = 50;

const bodySchema = z.object({
  propertyId: z.string(),
  startDate: z.string(),
  endDate: z.string(), // inclusive, same convention as the rest of PricingRule
  price: z.number().min(0),
  minNights: z.number().int().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { propertyId, price, minNights } = parsed.data;
  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);

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

  // Re-editing the exact same range updates that rule instead of stacking a
  // second one on top of it at the same priority, where only insertion
  // order would decide which one actually won.
  const existing = await prisma.pricingRule.findFirst({
    where: { propertyId, name: { startsWith: MANUAL_PREFIX }, startDate, endDate },
  });

  const name = `${MANUAL_PREFIX} ${parsed.data.startDate} to ${parsed.data.endDate}`;
  const rule = existing
    ? await prisma.pricingRule.update({
        where: { id: existing.id },
        data: { price, minNights: minNights ?? existing.minNights, active: true },
      })
    : await prisma.pricingRule.create({
        data: {
          propertyId,
          name,
          ruleType: "SEASONAL",
          startDate,
          endDate,
          price,
          minNights: minNights ?? 1,
          priority: MANUAL_PRIORITY,
          active: true,
        },
      });

  // endDate is inclusive on PricingRule; the push range is exclusive, same
  // +1 day convention ruleRange() uses in app/api/pricing/route.ts.
  const pushTo = new Date(endDate.getTime() + 86400000);
  await enqueueAriUpdate(propertyId, startDate, pushTo, "RATE");
  await enqueueAriUpdate(propertyId, startDate, pushTo, "RESTRICTION");

  return NextResponse.json(rule, { status: existing ? 200 : 201 });
}
