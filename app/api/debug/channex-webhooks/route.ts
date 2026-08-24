import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { channexGet, channexPut, ChannexError } from "@/lib/channels/channex-core";

// List every webhook registered on Channex, and re-point them at the current
// domain in one call.
//
// Written for the move off the Railway hostname, but the problem is not
// one-off: Channex stores an absolute callback_url, so it keeps working
// against whatever domain was live when it was registered and gives no
// signal at all when that domain stops being the one we deploy to. Bookings
// simply arrive by poller instead of by push, minutes late rather than
// seconds, and nothing anywhere says why.
//
// Re-pointing is a PUT, deliberately, not a delete-and-recreate. A message
// webhook registered before Channex's Messages application was installed came
// back is_active:false and did not activate retroactively - recreating one is
// a real risk of landing back in that state, whereas editing the URL in place
// leaves activation untouched. Every webhook is read back afterwards so a
// flag that did change is visible here rather than discovered later.
//
//   GET /api/debug/channex-webhooks               -> list, changes nothing
//   GET /api/debug/channex-webhooks?repoint=true  -> PUT each callback_url

interface ChannexWebhook {
  id: string;
  attributes: {
    callback_url?: string;
    event_mask?: string;
    is_active?: boolean;
    send_data?: boolean;
    property_id?: string;
    is_global?: boolean;
  };
}

// The same value resolveAppOrigin() prefers, read at call time - so the
// sequence is "flip NEXTAUTH_URL, redeploy, call this", and the new URL can
// never disagree with what the rest of the app is using.
function targetCallbackUrl(): string | null {
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (!origin || origin.includes("localhost")) return null;
  return `${origin}/api/channex/webhook`;
}

function summarize(w: ChannexWebhook) {
  return {
    id: w.id,
    callbackUrl: w.attributes.callback_url ?? null,
    eventMask: w.attributes.event_mask ?? null,
    isActive: w.attributes.is_active ?? null,
    sendData: w.attributes.send_data ?? null,
    propertyId: w.attributes.property_id ?? null,
    isGlobal: w.attributes.is_global ?? null,
  };
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const repoint = new URL(req.url).searchParams.get("repoint") === "true";
  const target = targetCallbackUrl();

  let webhooks: ChannexWebhook[];
  try {
    const res = await channexGet<ChannexWebhook[]>("/webhooks");
    webhooks = res.data ?? [];
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, status: e.status, details: e.details }, { status: 502 });
  }

  const current = webhooks.map(summarize);

  if (!repoint) {
    return NextResponse.json({
      mode: "list - nothing sent to Channex",
      targetCallbackUrl: target,
      // Called out explicitly: a webhook already on the target URL needs no
      // work, and one that is registered but inactive will not deliver no
      // matter which URL it points at.
      needsRepoint: current.filter((w) => w.callbackUrl !== target).map((w) => w.id),
      inactive: current.filter((w) => w.isActive === false).map((w) => w.id),
      webhooks: current,
      nextStep: target
        ? "Add ?repoint=true to update every callback_url to the target."
        : "NEXTAUTH_URL is unset or points at localhost - set it to the public domain first.",
    });
  }

  if (!target) {
    return NextResponse.json(
      { error: "NEXTAUTH_URL is unset or points at localhost - refusing to write that to Channex" },
      { status: 400 }
    );
  }

  const results = [];
  for (const w of webhooks) {
    const before = summarize(w);
    if (before.callbackUrl === target) {
      results.push({ id: w.id, action: "skipped - already on target", before });
      continue;
    }
    try {
      await channexPut(`/webhooks/${w.id}`, { webhook: { callback_url: target } });
      // Read back rather than trusting the write: the point of the PUT was to
      // avoid disturbing is_active, and that is only actually known by asking.
      const after = await channexGet<ChannexWebhook>(`/webhooks/${w.id}`);
      results.push({
        id: w.id,
        action: "repointed",
        before,
        after: after.data ? summarize(after.data) : null,
      });
    } catch (err) {
      const e = err as ChannexError;
      results.push({
        id: w.id,
        action: "failed",
        before,
        error: { message: e.message, status: e.status, code: e.code, details: e.details },
      });
    }
  }

  const failed = results.filter((r) => r.action === "failed").length;
  return NextResponse.json({
    mode: "repoint",
    targetCallbackUrl: target,
    total: results.length,
    failed,
    deactivated: results
      .filter((r) => r.before?.isActive === true && r.after && r.after.isActive !== true)
      .map((r) => r.id),
    results,
  });
}
