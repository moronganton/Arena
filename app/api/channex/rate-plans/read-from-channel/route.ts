import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { channexGet, channexPost, ChannexError } from "@/lib/channels/channex-core";
import { readChannelRatePlans } from "@/lib/channels/channel-rate-import";

// Reads the rate plans a property ALREADY sells on its channel, from the
// channel itself.
//
// The alternative this replaces is asking an operator to retype their whole
// rate structure into host24 from memory, or to screenshot it and hope a model
// reads the names right. Neither is necessary for the part that matters:
// Booking.com sends Channex the room types, the plan names, their ids and the
// parent/child links on every connection. It is only the numbers - percentage,
// minimum stay, cancellation policy - that are genuinely absent, and those are
// the ones the review screen asks a human to confirm anyway.
//
// Creates nothing. mapping_details is a read despite its verb, and provisioning
// still happens afterwards from whatever the operator approved.
//
//   POST /api/channex/rate-plans/read-from-channel   { propertyId }

/** Channex returns list rows flat and single resources JSON:API-shaped. */
function field<T>(row: Record<string, unknown> | null | undefined, key: string): T | undefined {
  if (!row) return undefined;
  const attrs = row.attributes as Record<string, unknown> | undefined;
  return (attrs?.[key] ?? row[key]) as T | undefined;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  // Ownership and eligibility in one check. This is also what keeps the
  // feature structurally unable to touch a Smoobu-managed property: no
  // ChannexListing row, no Channex property id, no call.
  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Channex reports connections account-wide with the property ids each
  // covers, so finding this property's channel means filtering the list.
  let rows: Record<string, unknown>[];
  try {
    const res = await channexGet<Record<string, unknown>[]>("/channels");
    rows = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: `Couldn't reach your channel manager (${e.message}).` }, { status: 502 });
  }

  const mine = rows.filter((r) => {
    const props = field<string[]>(r, "properties");
    return Array.isArray(props) && props.includes(guard.channexPropertyId);
  });

  if (mine.length === 0) {
    return NextResponse.json(
      {
        error:
          "No channel is connected to this property yet. Connect Booking.com in the Channels tab first, " +
          "then come back and read your rate plans from it.",
      },
      { status: 409 }
    );
  }

  // Booking.com is the one this is built around - it is where these operators
  // keep the structure they want mirrored. Any other connected channel is
  // still attempted rather than refused, because mapping_details is defined
  // per adapter and another channel answering is a better outcome than a
  // message saying host24 did not try.
  const active = mine.filter((r) => field<boolean>(r, "is_active") !== false);
  const candidates = active.length > 0 ? active : mine;
  const chosen =
    candidates.find((r) => /booking/i.test(field<string>(r, "channel") ?? "")) ?? candidates[0];

  const channelId = (chosen.id ?? field<string>(chosen, "id")) as string | undefined;
  if (!channelId) {
    return NextResponse.json({ error: "That channel connection has no id host24 can read." }, { status: 502 });
  }

  // Settings are read back off the connection rather than constructed here.
  // Every adapter takes a different shape, and mapping_details needs the same
  // credentials the connection already holds - guessing at them would break
  // on the second channel this ever runs against.
  let channel: string;
  let settings: Record<string, unknown>;
  try {
    const res = await channexGet<Record<string, unknown>>(`/channels/${channelId}`);
    channel = field<string>(res.data, "channel") ?? "";
    settings = field<Record<string, unknown>>(res.data, "settings") ?? {};
    if (!channel) {
      return NextResponse.json({ error: "That channel connection has no adapter code." }, { status: 502 });
    }
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: `Couldn't read that channel connection (${e.message}).` }, { status: 502 });
  }

  let details: unknown;
  try {
    const res = await channexPost<unknown>("/channels/mapping_details", { channel, settings });
    details = res.data;
  } catch (err) {
    const e = err as ChannexError;
    // A rejection here is nearly always the channel's own credentials being
    // stale, which the operator fixes in Channex rather than in host24 - so
    // say which channel, not just that something failed.
    return NextResponse.json(
      { error: `${channel} wouldn't share its rate plans (${e.message}). Check the connection in the Channels tab.` },
      { status: 502 }
    );
  }

  // Everything that decides whether the result is usable is pure and tested.
  return NextResponse.json({ channel, ...readChannelRatePlans(details) });
}
