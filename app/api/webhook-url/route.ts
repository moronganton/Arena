import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Returns the ready-to-paste webhook URLs for the authenticated owner.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = process.env.WEBHOOK_SECRET;
  const origin = new URL(req.url).origin;

  if (!secret) {
    return NextResponse.json({
      configured: false,
      message: "WEBHOOK_SECRET is not set in Railway Variables. Add it and redeploy first.",
    });
  }

  return NextResponse.json({
    configured: true,
    smoobu: `${origin}/api/smoobu/webhook?secret=${secret}`,
    beds24: `${origin}/api/beds24/webhook?secret=${secret}`,
  });
}
