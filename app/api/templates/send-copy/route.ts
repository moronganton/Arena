import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderTemplate, valuesFromReservation, SAMPLE_VALUES, type TemplateReservation } from "@/lib/templates";
import { sendTemplateCopyEmail } from "@/lib/notifications";
import { getTemplateImages, appendImageLinks, toEmailAttachments, publicBaseUrl } from "@/lib/template-images";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/templates/send-copy { subject, body, reservationId?, to? }
// Sends a clean copy of the rendered template to any email address (defaults to
// the host's account email). The guest is never messaged.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, body, reservationId, to, templateId } = await req.json();
  if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, name: true } });
  const recipient = (typeof to === "string" && to.trim()) || user?.email || "";
  if (!EMAIL_RE.test(recipient)) {
    return NextResponse.json({ error: "Enter a valid email address to send to." }, { status: 400 });
  }

  let values = SAMPLE_VALUES;
  if (reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, property: { ownerId: session.user.id } },
      include: {
        guest: { select: { name: true } },
        property: { select: { name: true, address: true } },
        accessCodes: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
      },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    values = valuesFromReservation(reservation as unknown as TemplateReservation, user?.name);
  }

  const rendered = renderTemplate(body, values).trim();

  // Mirror the guest email exactly: the stored body a guest receives already
  // carries the photo links, and their email carries the files themselves.
  const images = await getTemplateImages(templateId);
  const baseUrl = publicBaseUrl();
  const bodyText = appendImageLinks(rendered, images, baseUrl);
  const imageUrls = baseUrl ? images.map((img) => `${baseUrl}/api/templates/images/${img.id}/raw`) : [];

  try {
    await sendTemplateCopyEmail({
      to: recipient,
      subject: subject?.trim() || "Message from your host",
      bodyText,
      attachments: toEmailAttachments(images),
      imageUrls,
    });
    return NextResponse.json({
      success: true,
      to: recipient,
      imagesAttached: images.length,
      imageLinksOmitted: images.length > 0 && !baseUrl,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send email" }, { status: 502 });
  }
}
