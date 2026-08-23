import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";

// The 1x1 PNG used by channex-attachment-probe consistently 503'd on send,
// but a real photo from an iPhone sent fine minutes later on the same
// booking - this checks whether the difference is actually the MIME type
// (PC screenshot vs iPhone gallery photo, as suspected) rather than
// something else, by reading back exactly what was stored for each real
// outbound attachment on a reservation.
//
//   GET /api/debug/message-attachment-mimes?reservationId=<id>
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const messages = await prisma.message.findMany({
    where: { reservationId, direction: "OUTBOUND", attachments: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, channelFailed: true, channelError: true, createdAt: true, attachments: true },
  });

  const rows = messages.map((m) => {
    let urls: string[] = [];
    try {
      urls = JSON.parse(m.attachments || "[]");
    } catch {
      // left empty
    }
    return {
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      channelFailed: m.channelFailed,
      channelError: m.channelError,
      attachments: urls.map((u) => {
        const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(u);
        return match
          ? { mime: match[1], approxBytes: Math.ceil((match[2].length * 3) / 4) }
          : { mime: "unrecognised data URL shape", preview: u.slice(0, 60) };
      }),
    };
  });

  return NextResponse.json({ reservationId, count: rows.length, rows });
}
