import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public image endpoint — deliberately unauthenticated.
//
// Guests receive these URLs inside their Booking.com/Airbnb chat message, and
// those guests have no StayHQ session, so the link has to work for anyone
// holding it. The cuid is the capability. The response carries only the image
// bytes: no host, guest, property or reservation data is exposed here.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const image = await prisma.templateImage.findUnique({
    where: { id },
    select: { url: true, mimeType: true, fileName: true },
  });
  if (!image) return new NextResponse("Not found", { status: 404 });

  const comma = image.url.indexOf(",");
  if (!image.url.startsWith("data:") || comma === -1) {
    // Already a real URL (if storage later moves to S3/CDN) — hand it straight on.
    return NextResponse.redirect(image.url);
  }

  const bytes = Buffer.from(image.url.slice(comma + 1), "base64");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": image.mimeType || "image/jpeg",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${image.fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
