import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { prisma } from "@/lib/prisma";
import { channexGet, channexPost, channexPut, ChannexError } from "@/lib/channels/channex-core";

// Registers a second Channex webhook for guest-message events, mirroring the
// booking one already live (same callback_url, same is_global:false scoped
// to the property, event_mask as a plain string - all confirmed shapes from
// step 6). Tests whether inbound message delivery is gated by the same
// permission that returned 403 on GET /message_threads, or is independent
// of it.
//
// Installing Channex's "Messages" application unlocked GET /message_threads
// (403 -> 200) but did NOT retroactively activate a webhook registered
// beforehand - it still comes back is_active:false. ?activate=true tries
// PUT /webhooks/{id} to flip it, since no ack/activation endpoint has been
// confirmed any other way.
//
//   GET /api/debug/channex-register-message-webhook              -> dry run
//   GET /api/debug/channex-register-message-webhook?confirm=true  -> registers it
//   GET /api/debug/channex-register-message-webhook?activate=true -> tries to activate the existing one
// Derived, not pinned. This was hardcoded to the Railway hostname, which is
// the one place in the repo a domain change would not propagate - and it
// would fail silently, registering a webhook against a host we no longer
// deploy to. NEXTAUTH_URL is what resolveAppOrigin() prefers everywhere else,
// so this now agrees with the rest of the app by construction.
function webhookUrl(): string | null {
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!origin || origin.includes("localhost")) return null;
  return `${origin}/api/channex/webhook`;
}

// "booking" was the one confirmed value for the booking event - trying its
// obvious singular-noun counterpart first, same convention.
const EVENT_MASK_CANDIDATES = ["message", "guest_message", "thread"];

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;
  const userId = access.userId;

  const listing = await prisma.channexListing.findFirst({
    where: { property: { ownerId: userId } },
    include: { property: { select: { name: true } } },
  });
  if (!listing) return NextResponse.json({ error: "No ChannexListing found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const confirm = searchParams.get("confirm") === "true";
  const activate = searchParams.get("activate") === "true";

  if (activate) {
    const existing = await channexGet<Array<{ id: string; attributes: { event_mask: string; is_active: boolean } }>>("/webhooks");
    const messageWebhook = (existing.data ?? []).find((w) => w.attributes.event_mask === "message");
    if (!messageWebhook) {
      return NextResponse.json({ error: "No message webhook registered yet - run with ?confirm=true first" }, { status: 404 });
    }
    try {
      const res = await channexPut(`/webhooks/${messageWebhook.id}`, { webhook: { is_active: true, send_data: true } });
      return NextResponse.json({ attempted: "PUT is_active:true, send_data:true", status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      return NextResponse.json({
        attempted: "PUT is_active:true, send_data:true",
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      property: listing.property.name,
      callbackUrl: webhookUrl(),
      candidateEventMasks: EVENT_MASK_CANDIDATES,
      nextStep: "Add ?confirm=true to actually attempt registration.",
    });
  }

  const callbackUrl = webhookUrl();
  if (!callbackUrl) {
    return NextResponse.json(
      { error: "NEXTAUTH_URL is unset or points at localhost - refusing to register that with Channex" },
      { status: 400 }
    );
  }

  const attempts: unknown[] = [];
  let succeeded = false;
  for (const eventMask of EVENT_MASK_CANDIDATES) {
    if (succeeded) break;
    try {
      const res = await channexPost("/webhooks", {
        webhook: {
          callback_url: callbackUrl,
          is_global: false,
          property_id: listing.channexPropertyId,
          event_mask: eventMask,
        },
      });
      attempts.push({ eventMask, status: "ok", response: res.data });
      succeeded = true;
    } catch (err) {
      const e = err as ChannexError;
      attempts.push({ eventMask, status: "failed", error: { message: e.message, status: e.status, code: e.code, details: e.details } });
    }
  }

  let currentWebhooks: unknown = null;
  try {
    const res = await channexGet("/webhooks");
    currentWebhooks = res.data;
  } catch (err) {
    const e = err as ChannexError;
    currentWebhooks = { error: e.message };
  }

  return NextResponse.json({ succeeded, attempts, currentWebhooks });
}
