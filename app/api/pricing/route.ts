import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enqueueAriUpdate, defaultHorizon } from "@/lib/channels/ari-outbox";

// A rule's own date range if it has one, otherwise the standard push
// horizon - a rule with no end date still needs SOME bound to push against,
// not "forever".
function ruleRange(rule: { startDate: Date | null; endDate: Date | null }): { from: Date; to: Date } {
  if (rule.startDate || rule.endDate) {
    const horizon = defaultHorizon();
    const from = rule.startDate ?? horizon.from;
    // endDate on a PricingRule is inclusive (the last day it applies), so
    // the push range's exclusive end is one day past it.
    const to = rule.endDate ? new Date(rule.endDate.getTime() + 86400000) : horizon.to;
    return { from, to };
  }
  return defaultHorizon();
}

async function enqueuePriceChange(propertyId: string, rule: { startDate: Date | null; endDate: Date | null }) {
  const { from, to } = ruleRange(rule);
  // Both kinds, since a single rule can set price and/or minNights together
  // and there is no cheap way to know which changed from here.
  await enqueueAriUpdate(propertyId, from, to, "RATE");
  await enqueueAriUpdate(propertyId, from, to, "RESTRICTION");
}

const ruleSchema = z.object({
  propertyId: z.string(),
  name: z.string().min(1),
  ruleType: z.enum(["BASE", "WEEKEND", "SEASONAL", "LAST_MINUTE", "MINIMUM_STAY"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  price: z.number().optional(),
  adjustment: z.number().optional(),
  adjType: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  minNights: z.number().int().min(1).default(1),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");

  const rules = await prisma.pricingRule.findMany({
    where: {
      property: { ownerId: session!.user!.id },
      ...(propertyId ? { propertyId } : {}),
    },
    include: { property: { select: { id: true, name: true, currency: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  if (body.id) {
    // Update existing rule
    const existing = await prisma.pricingRule.findFirst({
      where: { id: body.id, property: { ownerId: session!.user!.id } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.pricingRule.update({
      where: { id: body.id },
      data: {
        name: body.name,
        ruleType: body.ruleType,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        daysOfWeek: body.daysOfWeek ? JSON.stringify(body.daysOfWeek) : undefined,
        price: body.price,
        adjustment: body.adjustment,
        adjType: body.adjType,
        minNights: body.minNights,
        priority: body.priority,
        active: body.active,
      },
    });
    // Both the old and new range: a date dropped from the rule's coverage
    // still needs re-materializing against whatever now applies instead.
    await enqueuePriceChange(existing.propertyId, existing);
    await enqueuePriceChange(updated.propertyId, updated);
    return NextResponse.json(updated);
  }

  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: parsed.data.propertyId, ownerId: session!.user!.id },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const rule = await prisma.pricingRule.create({
    data: {
      ...parsed.data,
      daysOfWeek: parsed.data.daysOfWeek ? JSON.stringify(parsed.data.daysOfWeek) : undefined,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    },
  });

  await enqueuePriceChange(rule.propertyId, rule);

  return NextResponse.json(rule, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const rule = await prisma.pricingRule.findFirst({
    where: { id, property: { ownerId: session!.user!.id } },
  });
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.pricingRule.delete({ where: { id } });

  // The rule's coverage now needs re-materializing without it.
  await enqueuePriceChange(rule.propertyId, rule);

  return NextResponse.json({ success: true });
}
