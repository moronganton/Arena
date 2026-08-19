import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channexPost, channexGet, ChannexError } from "@/lib/channels/channex-core";

// Discovers Channex's webhook-registration and booking-creation shapes
// against the real sandbox API - both /bookings and /webhooks came back as
// real, empty, listable JSON:API collections in the explore probe, which
// strongly suggests both support POST too, consistent with the rest of this
// API being fully RESTful.
//
// Registering the webhook now (before the receiver at /api/channex/webhook
// exists) is deliberate and harmless: Channex will just get connection
// failures until the receiver is deployed, which costs nothing in a sandbox
// account with no real traffic.
//
// Creating a test booking here serves two purposes at once: it reveals the
// real booking payload shape needed to build the webhook receiver, AND it
// becomes the actual test booking used later to verify the full intake ->
// PIN code -> cleaning task -> AI greeting chain fires with no Smoobu
// involvement.
//
//   GET /api/debug/channex-webhook-probe                    -> dry run, shows candidate payloads
//   GET /api/debug/channex-webhook-probe?registerWebhook=true -> actually registers the webhook
//   GET /api/debug/channex-webhook-probe?createBooking=true   -> actually creates a test booking
const WEBHOOK_URL = "https://stayhq-dev.up.railway.app/api/channex/webhook";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const listing = await prisma.channexListing.findFirst({
    where: { property: { ownerId: session.user.id } },
    include: { property: { select: { name: true } } },
  });
  if (!listing) return NextResponse.json({ error: "No ChannexListing found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const registerWebhook = searchParams.get("registerWebhook") === "true";
  const createBooking = searchParams.get("createBooking") === "true";

  const webhookPayload = {
    webhook: {
      callback_url: WEBHOOK_URL,
      // Confirmed via a real 422: property_id is required unless
      // is_global is true. The receiver being built handles every Channex
      // property generically, not just this one, so account-wide is the
      // correct scope, not a per-property webhook that would need
      // re-registering for every future property.
      is_global: true,
      // Confirmed via a real 422: the field is `event_mask`, not `event` -
      // "mask" suggesting an array of event types rather than one string.
      // Booking-related event names themselves are still unconfirmed
      // guesses; a validation error would name the real ones.
      event_mask: ["booking", "booking_new", "booking_modification", "booking_cancellation"],
    },
  };

  const checkinDate = "2027-10-05";
  const checkoutDate = "2027-10-07";
  const bookingPayload = {
    booking: {
      property_id: listing.channexPropertyId,
      ota_reservation_code: `stayhq-probe-${Date.now()}`,
      ota_name: "test",
      arrival_date: checkinDate,
      departure_date: checkoutDate,
      currency: "EUR",
      customer: {
        name: "Probe Test",
        surname: "Guest",
        mail: "probe-test@example.com",
      },
      rooms: [
        {
          room_type_id: listing.channexRoomTypeId,
          rate_plan_id: listing.channexRatePlanId,
          days: {
            [checkinDate]: "50.00",
            "2027-10-06": "50.00",
          },
          occupancy: { adults: 2 },
        },
      ],
    },
  };

  if (!registerWebhook && !createBooking) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      property: listing.property.name,
      webhookUrl: WEBHOOK_URL,
      candidateWebhookPayload: webhookPayload,
      candidateBookingPayload: bookingPayload,
      nextStep: "Add ?registerWebhook=true and/or ?createBooking=true to actually send these.",
    });
  }

  const results: Record<string, unknown> = {};

  if (registerWebhook) {
    try {
      const res = await channexPost("/webhooks", webhookPayload);
      results.webhookRegistration = { status: "ok", payload: webhookPayload, response: res.data };
    } catch (err) {
      const e = err as ChannexError;
      results.webhookRegistration = {
        status: "failed",
        payload: webhookPayload,
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      };
    }
  }

  if (createBooking) {
    try {
      const res = await channexPost("/bookings", bookingPayload);
      results.bookingCreation = { status: "ok", payload: bookingPayload, response: res.data };
    } catch (err) {
      const e = err as ChannexError;
      results.bookingCreation = {
        status: "failed",
        payload: bookingPayload,
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      };
    }

    // Read the list back regardless, so a failed create's real shape
    // expectations can still be compared against whatever WAS accepted, if
    // anything (JSON:API bulk-style APIs sometimes partially accept).
    try {
      const res = await channexGet("/bookings");
      results.bookingsListAfter = { status: "ok", response: res.data };
    } catch (err) {
      const e = err as ChannexError;
      results.bookingsListAfter = { status: "failed", error: { message: e.message, status: e.status, code: e.code } };
    }
  }

  return NextResponse.json({ property: listing.property.name, results });
}
