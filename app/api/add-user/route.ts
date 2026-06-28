import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const existing = await prisma.user.findUnique({ where: { email: "manager@stayhq.com" } });
  if (existing) {
    return NextResponse.json({ message: "User already exists.", email: "manager@stayhq.com", password: "manage456" });
  }

  await prisma.user.create({
    data: { email: "manager@stayhq.com", name: "Property Manager", password: "manage456" },
  });

  return NextResponse.json({
    message: "User created successfully.",
    email: "manager@stayhq.com",
    password: "manage456",
  });
}
