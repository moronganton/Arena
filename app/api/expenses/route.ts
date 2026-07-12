import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET ?month=YYYY-MM&propertyId — list expenses
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const propertyId = searchParams.get("propertyId");

  const where: Record<string, unknown> = { ownerId: session.user.id };
  if (propertyId) where.propertyId = propertyId;
  if (month) {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    where.date = { gte: start, lt: end };
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { property: { select: { id: true, name: true } } },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(expenses);
}

// POST — create an expense
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.description || !body.amount || !body.category || !body.date) {
    return NextResponse.json({ error: "description, amount, category and date are required" }, { status: 400 });
  }

  if (body.propertyId) {
    const property = await prisma.property.findFirst({
      where: { id: body.propertyId, ownerId: session.user.id },
    });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const expense = await prisma.expense.create({
    data: {
      ownerId: session.user.id,
      category: body.category,
      description: body.description,
      amount: parseFloat(body.amount),
      currency: body.currency || "EUR",
      date: new Date(body.date),
      propertyId: body.propertyId || null,
      invoiceImage: body.invoiceImage || null,
      aiExtracted: !!body.aiExtracted,
    },
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(expense, { status: 201 });
}

// PATCH — edit an expense
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ...data } = await req.json();
  const expense = await prisma.expense.findFirst({
    where: { id, ownerId: session.user.id },
  });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      category: data.category,
      description: data.description,
      amount: data.amount !== undefined ? parseFloat(data.amount) : undefined,
      currency: data.currency,
      date: data.date ? new Date(data.date) : undefined,
      propertyId: data.propertyId !== undefined ? data.propertyId || null : undefined,
    },
    include: { property: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}

// DELETE ?id
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const expense = await prisma.expense.findFirst({
    where: { id, ownerId: session.user.id },
  });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.expense.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
