import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — the signed-in user's display name and email, read fresh from the
// database rather than from the JWT (which holds whatever was true at sign-in
// and can be up to a day stale).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });
  return NextResponse.json({ name: user?.name ?? "", email: user?.email ?? "" });
}

// PATCH { name } — set the display name.
//
// This is not only cosmetic: the same value fills the [Host Name] merge field in
// message templates, so it is signed at the bottom of real guest messages. A
// leftover seed value like "Demo Host" goes out to guests until it is corrected.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  if (typeof name !== "string") {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters." }, { status: 400 });
  }
  if (clean.length > 60) {
    return NextResponse.json({ error: "Keep the name under 60 characters." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { name: clean } });

  return NextResponse.json({ success: true, name: clean });
}
