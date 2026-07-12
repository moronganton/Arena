import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function monthStart(month?: string | null): Date {
  const m = month || new Date().toISOString().slice(0, 7);
  return new Date(`${m}-01T00:00:00Z`);
}

// GET — active recurring cost templates (optionally those active in ?month)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");

  let where: Record<string, unknown> = { ownerId: session.user.id };
  if (month) {
    const start = monthStart(month);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    where = {
      ...where,
      startDate: { lt: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    };
  } else {
    where = { ...where, endDate: null };
  }

  const items = await prisma.recurringExpense.findMany({
    where,
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(items);
}

// POST — create a recurring cost, starting from the given month
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.description || !body.amount || !body.category) {
    return NextResponse.json({ error: "description, amount and category required" }, { status: 400 });
  }

  const item = await prisma.recurringExpense.create({
    data: {
      ownerId: session.user.id,
      category: body.category,
      description: body.description,
      amount: parseFloat(body.amount),
      currency: body.currency || "EUR",
      startDate: monthStart(body.startMonth),
      propertyId: body.propertyId || null,
    },
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(item, { status: 201 });
}

// PATCH — modify amount from a given month forward (preserves history):
// the old template is closed at the end of the previous month and a new
// one starts with the new amount.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, amount, effectiveMonth, description } = await req.json();
  const existing = await prisma.recurringExpense.findFirst({
    where: { id, ownerId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const newAmount = parseFloat(amount);
  const effective = monthStart(effectiveMonth);

  // If the change is effective from the template's own start month, just update in place
  if (effective.getTime() <= existing.startDate.getTime()) {
    const updated = await prisma.recurringExpense.update({
      where: { id },
      data: { amount: newAmount, description: description ?? undefined },
      include: { property: { select: { id: true, name: true } } },
    });
    return NextResponse.json(updated);
  }

  // Close the old template the day before the effective month, open a new one
  const dayBefore = new Date(effective.getTime() - 86400000);
  await prisma.recurringExpense.update({
    where: { id },
    data: { endDate: dayBefore },
  });
  const replacement = await prisma.recurringExpense.create({
    data: {
      ownerId: session.user.id,
      category: existing.category,
      description: description ?? existing.description,
      amount: newAmount,
      currency: existing.currency,
      startDate: effective,
      propertyId: existing.propertyId,
    },
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(replacement);
}

// DELETE ?id&month — stop the recurring cost from the given month onward
// (past months keep it); hard-deletes if it never applied to a past month.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await prisma.recurringExpense.findFirst({
    where: { id, ownerId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stopFrom = monthStart(searchParams.get("month"));

  if (stopFrom.getTime() <= existing.startDate.getTime()) {
    await prisma.recurringExpense.delete({ where: { id } });
    return NextResponse.json({ success: true, deleted: true });
  }

  await prisma.recurringExpense.update({
    where: { id },
    data: { endDate: new Date(stopFrom.getTime() - 86400000) },
  });
  return NextResponse.json({ success: true, ended: true });
}
