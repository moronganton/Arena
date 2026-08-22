import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexGet, channexPut, ChannexError } from "@/lib/channels/channex-core";

// Closes the one open item from the Channex integration audit: the webhook
// route (app/api/channex/webhook/route.ts) has always been able to check an
// x-webhook-secret header against CHANNEX_WEBHOOK_SECRET, but nothing ever
// told Channex to actually send that header - it was registered with
// headers: null (see channex-register-message-webhook, which never set
// headers either).
//
// There is no separate "Channex webhook UI" for this - that phrase in the
// old comment on the webhook route was an unconfirmed guess. Checked the
// real API docs (webhook-collection.md): headers is a field on the webhook
// object itself, settable only via POST/PUT /webhooks. So this is the one
// and only place to set it.
//
// Reads CHANNEX_WEBHOOK_SECRET from this server's own env and sends it
// straight to Channex - the value is never returned in the response here.
//
//   GET /api/debug/channex-set-webhook-secret              -> dry run, lists webhooks + current headers
//   GET /api/debug/channex-set-webhook-secret?confirm=true -> PUTs the header onto every webhook
export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const secret = process.env.CHANNEX_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CHANNEX_WEBHOOK_SECRET is not set on this server - set it in Railway first, then re-run this." },
      { status: 400 }
    );
  }

  const existing = await channexGet<Array<{ id: string; attributes: { event_mask: string; callback_url: string; headers: Record<string, string> | null } }>>(
    "/webhooks"
  );
  const webhooks = existing.data ?? [];
  if (webhooks.length === 0) {
    return NextResponse.json({ error: "No webhooks registered on this Channex account yet" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const confirm = searchParams.get("confirm") === "true";

  if (!confirm) {
    return NextResponse.json({
      mode: "dry run - nothing sent to Channex",
      webhooks: webhooks.map((w) => ({
        id: w.id,
        eventMask: w.attributes.event_mask,
        callbackUrl: w.attributes.callback_url,
        hasSecretHeaderAlready: !!w.attributes.headers?.["x-webhook-secret"],
      })),
      nextStep: "Add ?confirm=true to PUT the x-webhook-secret header onto every webhook listed above.",
    });
  }

  const results: unknown[] = [];
  for (const w of webhooks) {
    try {
      const res = await channexPut(`/webhooks/${w.id}`, {
        webhook: { headers: { ...(w.attributes.headers ?? {}), "x-webhook-secret": secret } },
      });
      results.push({ id: w.id, eventMask: w.attributes.event_mask, status: "ok", response: res.data });
    } catch (err) {
      const e = err as ChannexError;
      results.push({
        id: w.id,
        eventMask: w.attributes.event_mask,
        status: "failed",
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  return NextResponse.json({ mode: "applied", results });
}
