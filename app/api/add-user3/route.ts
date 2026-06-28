import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const existing = await prisma.user.findUnique({ where: { email: "guest@stayhq.com" } });
  if (existing) {
    return NextResponse.json({ message: "User already exists.", email: "guest@stayhq.com", password: "guest789" });
  }

  await prisma.user.create({
    data: { email: "guest@stayhq.com", name: "Guest Viewer", password: "guest789" },
  });

  return NextResponse.json({
    message: "User created successfully.",
    email: "guest@stayhq.com",
    password: "guest789",
  });
}
