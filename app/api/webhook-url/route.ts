import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Returns the ready-to-paste webhook URLs for the authenticated owner.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = process.env.WEBHOOK_SECRET;

  // Behind Railway's proxy the request URL is the internal address —
  // derive the public origin from forwarded headers or the configured URL.
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  const origin =
    forwardedHost && !forwardedHost.includes("localhost")
      ? `${forwardedProto}://${forwardedHost}`
      : process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin;

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
