import { NextRequest, NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/debug-auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { channexGet, channexPost, channexPut, channexDelete, ChannexError } from "@/lib/channels/channex-core";
import { prisma } from "@/lib/prisma";

// Settles one question the Channex documentation cannot answer: whether a
// cancellation policy can be created and attached to a rate plan through the
// API, or only through the Channex UI.
//
// The docs are silent. All 110 pages of docs.channex.io mention
// `cancellation_policy_id` exactly zero times, yet the field comes back on
// every rate plan, GET /cancellation_policies answers 200 with a proper
// JSON:API envelope, and the changelog records "Associate cancellation
// policies and tax sets with rate plans" shipping on 2023-01-23 - alongside
// tax_set_id, which IS documented. Four signals say the feature is real and
// simply undocumented; only an actual write settles whether it is writable.
//
// So this probes rather than assumes, and reports Channex's response verbatim
// at every step. A rejection is as informative as a success here: Channex
// validation errors name the fields they object to, which is how the payload
// shape gets established when there is no schema to read.
//
//   GET ?                              - read current state only
//   GET ?apply=true                    - create a policy, report what happens
//   GET ?apply=true&attachTo=<title>   - and attach it to that rate plan
//   GET ?deletePolicyId=<id>           - clean up afterwards

type Step = { step: string; ok: boolean; status?: number; code?: string; result: unknown };

async function attempt(label: string, fn: () => Promise<unknown>): Promise<Step> {
  try {
    return { step: label, ok: true, result: await fn() };
  } catch (e) {
    if (e instanceof ChannexError) {
      return { step: label, ok: false, status: e.status, code: e.code, result: e.details ?? e.message };
    }
    return { step: label, ok: false, result: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  // This route writes to Channex. Production shares the same code and, at time
  // of writing, the same DEBUG_API_SECRET - so refuse there outright rather
  // than rely on the caller passing the right property id.
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "";
  if (/app\.host24\.ai/i.test(appUrl)) {
    return NextResponse.json(
      { error: `refusing to run: NEXTAUTH_URL is ${appUrl}, which is production` },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "true";
  const attachTo = searchParams.get("attachTo");
  const deletePolicyId = searchParams.get("deletePolicyId");

  let propertyId = searchParams.get("propertyId");
  if (!propertyId) {
    const candidates = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX", channexListing: { isNot: null } },
      select: { id: true },
    });
    if (candidates.length !== 1) {
      return NextResponse.json(
        { error: `pass ?propertyId= - found ${candidates.length} Channex properties` },
        { status: 400 }
      );
    }
    propertyId = candidates[0].id;
  }

  const guard = await requireChannexProperty(propertyId, access.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const steps: Step[] = [];
  const scope = `filter[property_id]=${guard.channexPropertyId}`;

  if (deletePolicyId) {
    steps.push(await attempt(`DELETE /cancellation_policies/${deletePolicyId}`, () =>
      channexDelete(`/cancellation_policies/${deletePolicyId}`)
    ));
    return NextResponse.json({ property: guard.propertyName, steps });
  }

  steps.push(await attempt("GET /cancellation_policies (before)", () =>
    channexGet(`/cancellation_policies?${scope}`)
  ));
  steps.push(await attempt("GET /rate_plans (current cancellation_policy_id per plan)", async () => {
    const res = await channexGet<Array<{ id: string; attributes?: Record<string, unknown> }>>(
      `/rate_plans?${scope}`
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    return rows.map((r) => ({
      id: r.id,
      title: r.attributes?.title,
      cancellation_policy_id: r.attributes?.cancellation_policy_id ?? "(field absent)",
      tax_set_id: r.attributes?.tax_set_id ?? null,
    }));
  }));

  if (!apply) {
    return NextResponse.json({
      property: guard.propertyName,
      status: "read only - add &apply=true to attempt a write",
      steps,
    });
  }

  // Field names taken from the only place Channex reveals them: the policy
  // object embedded in a booking payload (bookings-collection docs). Whether
  // they are also the *input* names is exactly what this call establishes.
  const title = `host24 API probe ${new Date().toISOString().slice(0, 16)}`;
  const body = {
    cancellation_policy: {
      title,
      property_id: guard.channexPropertyId,
      currency: "EUR",
      cancellation_policy_logic: "free",
      guarantee_payment_policy: "none",
      non_show_policy: "default",
    },
  };
  steps.push(await attempt("POST /cancellation_policies", () => channexPost("/cancellation_policies", body)));

  const created = steps[steps.length - 1];
  const newId =
    created.ok && created.result && typeof created.result === "object"
      ? ((created.result as { data?: { id?: string } }).data?.id ?? null)
      : null;

  if (newId && attachTo) {
    const plans = await channexGet<Array<{ id: string; attributes?: { title?: string } }>>(`/rate_plans?${scope}`);
    const rows = Array.isArray(plans.data) ? plans.data : [];
    const target = rows.find((r) => (r.attributes?.title ?? "").toLowerCase() === attachTo.toLowerCase());
    if (!target) {
      steps.push({ step: `attach to "${attachTo}"`, ok: false, result: `no rate plan with that title` });
    } else {
      steps.push(await attempt(`PUT /rate_plans/${target.id} (set cancellation_policy_id)`, () =>
        channexPut(`/rate_plans/${target.id}`, { rate_plan: { cancellation_policy_id: newId } })
      ));
      steps.push(await attempt("GET that rate plan back", async () => {
        const r = await channexGet<{ attributes?: Record<string, unknown> }>(`/rate_plans/${target.id}`);
        return {
          title: r.data?.attributes?.title,
          cancellation_policy_id: r.data?.attributes?.cancellation_policy_id ?? "(field absent)",
        };
      }));
    }
  }

  return NextResponse.json({
    property: guard.propertyName,
    createdPolicyId: newId,
    verdict: created.ok
      ? "POST accepted - cancellation policies ARE writable via the API"
      : "POST rejected - see the step's result for what Channex objects to",
    cleanup: newId ? `?deletePolicyId=${newId}` : null,
    steps,
  });
}
