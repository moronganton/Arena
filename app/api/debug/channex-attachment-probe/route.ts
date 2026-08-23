import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexPost } from "@/lib/channels/channex-core";
import { channexBookingIdFromExternalId, fetchBookingMessages } from "@/lib/channels/channex-messages";

// A real outbound photo (Anton Morong / BDC-6101940794) sent via
// relayMessageToChannel came back "sent" (no thrown error) but the message
// Channex actually stored has attachments: [] - the upload+attach silently
// didn't take, even though nothing in our own code path threw. This probes
// the raw upload -> send round trip with full response bodies at every step,
// something sendBookingMessage/uploadChannexAttachment intentionally don't
// log in production, to see exactly where the attachment gets dropped.
//
//   GET /api/debug/channex-attachment-probe?reservationId=<id>
const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const reservationId = new URL(req.url).searchParams.get("reservationId");
  if (!reservationId) return NextResponse.json({ error: "reservationId is required" }, { status: 400 });

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: userId } },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  const bookingId = channexBookingIdFromExternalId(reservation.externalId ?? "");
  if (!bookingId) return NextResponse.json({ error: "No Channex booking id on that reservation" }, { status: 400 });

  const steps: Record<string, unknown> = {};

  // Step 1: upload, keeping the FULL raw response (uploadChannexAttachment
  // only keeps res.data?.id).
  const uploadRes = await channexPost<Record<string, unknown>>("/attachments", {
    attachment: { file: ONE_PX_PNG_BASE64, file_name: "probe.png", file_type: "image/png" },
  });
  steps.uploadResponse = uploadRes;
  const attachmentId = (uploadRes.data as { id?: string } | undefined)?.id;

  if (!attachmentId) {
    return NextResponse.json({ bookingId, steps, verdict: "Upload returned no id - stopped before sending." });
  }

  // Step 2: send, trying both a singular id and a plural array, since a
  // silently-ignored wrong field name is the leading suspect for "call
  // succeeds, attachment never shows up".
  const singularRes = await channexPost<Record<string, unknown>>(`/bookings/${bookingId}/messages`, {
    message: { message: "", attachment_id: attachmentId },
  });
  steps.sendWithAttachmentIdSingular = singularRes;

  // Step 3: read the thread back and find our two probe messages by id, to
  // see what Channex actually persisted for each - not just what it echoed
  // back in the POST response.
  const thread = await fetchBookingMessages(bookingId);
  const sortedRecent = thread
    .filter((m) => m.attributes.sender === "property")
    .sort((a, b) => new Date(b.attributes.inserted_at).getTime() - new Date(a.attributes.inserted_at).getTime())
    .slice(0, 5);
  steps.mostRecentPropertyMessages = sortedRecent;

  return NextResponse.json({ bookingId, attachmentId, steps });
}
