import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendAccessCodeEmail } from "@/lib/notifications";
import { sendSmoobuGuestMessage } from "@/lib/channels/smoobu-core";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reservationId, code, guestName, propertyName, validFrom, validTo, sendEmail, sendSmoobu, sendMessage } =
    await req.json();

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, property: { ownerId: session.user.id } },
    include: { guest: true, property: true },
  });
  if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

  const results = { email: false, smoobu: false, message: false, errors: [] as string[] };

  // Format the message
  const fmt = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const guestMessage =
    `Hi ${guestName}! Your door access code for ${propertyName} is: ${code}\n` +
    `It is valid from ${fmt(validFrom)} until ${fmt(validTo)}. ` +
    `Please don't share it with others. Safe travels!`;

  // Send email
  if (sendEmail && reservation.guest.email) {
    try {
      await sendAccessCodeEmail({
        guestName,
        guestEmail: reservation.guest.email,
        propertyName,
        code,
        validFrom: new Date(validFrom),
        validTo: new Date(validTo),
      });
      results.email = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Email failed: ${msg}`);
      console.error("Failed to send PIN email:", err);
    }
  }

  // Send via Smoobu/OTA
  if (sendSmoobu && reservation.externalId?.startsWith("smoobu-")) {
    try {
      const sent = await sendSmoobuGuestMessage(session.user.id, reservation.externalId, guestMessage);
      if (sent) results.smoobu = true;
      else results.errors.push("Smoobu: message not sent (trial limitation or OTA blocked)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Smoobu failed: ${msg}`);
      console.error("Failed to send PIN message via Smoobu:", err);
    }
  }

  // Post to message thread
  if (sendMessage) {
    try {
      await prisma.message.create({
        data: {
          reservationId,
          direction: "OUTBOUND",
          channel: "EMAIL",
          body: guestMessage,
          isRead: true,
        },
      });
      results.message = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Message thread failed: ${msg}`);
      console.error("Failed to post access code message to thread:", err);
    }
  }

  if (results.errors.length === 0) {
    return NextResponse.json(results);
  } else if (results.email || results.smoobu || results.message) {
    return NextResponse.json(results, { status: 207 }); // Partial success
  } else {
    return NextResponse.json(results, { status: 500 });
  }
}
