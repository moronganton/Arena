import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendAccessCodeEmail } from "@/lib/notifications";
import { relayMessageToChannel } from "@/lib/channels/relay";

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

  // Send through the booking channel (Smoobu or Channex). This matters most
  // here of all the outbound paths: a Channex booking carries no guest email,
  // so if the door code does not go out over the channel it reaches the guest
  // nowhere at all.
  if (sendSmoobu) {
    const relay = await relayMessageToChannel(
      { externalId: reservation.externalId, ownerId: session.user.id },
      guestMessage
    );
    if (relay.status === "sent") {
      results.smoobu = true;
    } else if (relay.status === "skipped") {
      results.errors.push(`Channel message not sent: ${relay.reason}`);
      console.log(`[access-code-message] relay skipped for reservation ${reservationId}: ${relay.reason}`);
    } else {
      results.errors.push(`${relay.provider} failed: ${relay.error}`);
      console.error(`Failed to send PIN message via ${relay.provider}:`, relay.error);
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
