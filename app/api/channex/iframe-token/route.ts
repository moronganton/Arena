import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channexPost, channexAppOrigin } from "@/lib/channels/channex-core";

// Mints a short-lived Channex session and returns an embeddable URL, so
// channel connection and room/rate mapping happen INSIDE StayHQ instead of
// sending the host off to log into Channex's own dashboard.
//
// This is the part of the white-label that is actually ours to control.
// Channex's brand still appears once, unavoidably, in Booking.com's own
// extranet: the property has to pick "Channex" from Booking.com's certified
// connectivity-provider list (confirmed against Channex's own Booking.com
// mapping guide - there is no branded alias, and Booking.com's provider list
// is Booking.com's). Everything AFTER that step is ours, and this is what
// keeps it that way - the host never needs a Channex login.
//
// The token is single-use and expires in 15 minutes, so it is minted per
// click rather than stored. `app_mode=headless` is what strips Channex's own
// navigation and chrome from the embedded page.
//
//   POST /api/channex/iframe-token   { "propertyId": "...", "page": "/channels" }
//
// `page` is optional and defaults to the channels/mapping screen. Channex can
// serve any of its pages this way (e.g. "/messages"), which is why it is a
// parameter rather than hardcoded - but it is validated below, since it lands
// in a URL handed to an iframe.
const ALLOWED_PAGES = new Set(["/channels", "/messages", "/inventory"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  const page = (body?.page as string | undefined) ?? "/channels";
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!ALLOWED_PAGES.has(page)) {
    return NextResponse.json({ error: `Unsupported page ${page}` }, { status: 400 });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: session.user.id },
    select: {
      name: true,
      channelProvider: true,
      channexListing: { select: { channexPropertyId: true } },
    },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json({ error: `${property.name} isn't on Channex` }, { status: 400 });
  }
  if (!property.channexListing) {
    return NextResponse.json({ error: `${property.name} isn't provisioned on Channex yet` }, { status: 400 });
  }

  const channexPropertyId = property.channexListing.channexPropertyId;

  // Channex's docs: "username: This should be the name of the user that is
  // logged into your PMS system". It is a display label on their side - the
  // session is still authorised as our API key's user, which is why property
  // ownership is verified above rather than trusted to this value.
  const username = session.user.name || session.user.email || "StayHQ";

  const tokenRes = await channexPost<{ token?: string }>("/auth/one_time_token", {
    one_time_token: { property_id: channexPropertyId, username },
  });
  const token = tokenRes.data?.token;
  if (!token) {
    return NextResponse.json({ error: "Channex did not return a session token" }, { status: 502 });
  }

  // redirect_to is left unencoded to match Channex's documented URL shape
  // exactly ("redirect_to=/channels"); it is safe because `page` is checked
  // against ALLOWED_PAGES above rather than taken from the request as-is.
  const url =
    `${channexAppOrigin()}/auth/exchange` +
    `?oauth_session_key=${encodeURIComponent(token)}` +
    `&app_mode=headless` +
    `&redirect_to=${page}` +
    `&property_id=${encodeURIComponent(channexPropertyId)}`;

  return NextResponse.json({ url, property: property.name });
}
