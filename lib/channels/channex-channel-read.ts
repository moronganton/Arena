import { channexGet, channexPost, ChannexError } from "./channex-core";
import { readChannelRatePlans, type ChannelReadResult } from "./channel-rate-import";

// Finding a property's channel connection and asking it what the property
// sells.
//
// Lives here rather than in the route so the debug probe and the real endpoint
// run the SAME resolution. A probe that reimplements the lookup can pass while
// the endpoint it was meant to vouch for fails, which makes it worse than no
// probe at all.

/** Channex returns list rows flat and single resources JSON:API-shaped. */
function field<T>(row: Record<string, unknown> | null | undefined, key: string): T | undefined {
  if (!row) return undefined;
  const attrs = row.attributes as Record<string, unknown> | undefined;
  return (attrs?.[key] ?? row[key]) as T | undefined;
}

export type ChannelReadOutcome =
  | ({ ok: true; channel: string; channelId: string } & ChannelReadResult)
  | { ok: false; status: number; error: string };

export async function readRatePlansFromChannel(channexPropertyId: string): Promise<ChannelReadOutcome> {
  // Channex reports connections account-wide with the property ids each
  // covers, so finding this property's channel means filtering the list.
  let rows: Record<string, unknown>[];
  try {
    const res = await channexGet<Record<string, unknown>[]>("/channels");
    rows = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    const e = err as ChannexError;
    return { ok: false, status: 502, error: `Couldn't reach your channel manager (${e.message}).` };
  }

  const mine = rows.filter((r) => {
    const props = field<string[]>(r, "properties");
    return Array.isArray(props) && props.includes(channexPropertyId);
  });

  if (mine.length === 0) {
    return {
      ok: false,
      status: 409,
      error:
        "No channel is connected to this property yet. Connect Booking.com in the Channels tab first, " +
        "then come back and read your rate plans from it.",
    };
  }

  // Booking.com is what this is built around - it is where these operators
  // keep the structure they want mirrored. Any other connected channel is
  // still attempted rather than refused: mapping_details is defined per
  // adapter, and another channel answering beats a message saying host24
  // never tried.
  const active = mine.filter((r) => field<boolean>(r, "is_active") !== false);
  const candidates = active.length > 0 ? active : mine;
  const chosen = candidates.find((r) => /booking/i.test(field<string>(r, "channel") ?? "")) ?? candidates[0];

  const channelId = (chosen.id ?? field<string>(chosen, "id")) as string | undefined;
  if (!channelId) return { ok: false, status: 502, error: "That channel connection has no id host24 can read." };

  // Settings are read back off the connection rather than constructed here.
  // Every adapter takes a different shape, and mapping_details needs the same
  // credentials the connection already holds - guessing at them would break on
  // the second channel this ever runs against.
  let channel: string;
  let settings: Record<string, unknown>;
  try {
    const res = await channexGet<Record<string, unknown>>(`/channels/${channelId}`);
    channel = field<string>(res.data, "channel") ?? "";
    settings = field<Record<string, unknown>>(res.data, "settings") ?? {};
    if (!channel) return { ok: false, status: 502, error: "That channel connection has no adapter code." };
  } catch (err) {
    const e = err as ChannexError;
    return { ok: false, status: 502, error: `Couldn't read that channel connection (${e.message}).` };
  }

  try {
    const res = await channexPost<unknown>("/channels/mapping_details", { channel, settings });
    return { ok: true, channel, channelId, ...readChannelRatePlans(res.data, channel) };
  } catch (err) {
    const e = err as ChannexError;
    // A rejection here is nearly always the channel's own credentials going
    // stale, which is fixed in Channex rather than in host24 - so name the
    // channel, not just the failure.
    return {
      ok: false,
      status: 502,
      error: `${channel} wouldn't share its rate plans (${e.message}). Check the connection in the Channels tab.`,
    };
  }
}
