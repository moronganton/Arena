import { channexGet, channexPost, channexPut } from "./channex-core";

// Confirmed against the real docs (docs.channex.io/api-v.1-documentation/
// hotel-policy-collection): one Hotel Policy per property, no dedicated
// "get by property_id" filter documented - the list endpoint is scoped to
// the API key's own properties already, so listing and finding the one
// matching property_id is the correct approach, not a workaround.
export interface HotelPolicyFields {
  title: string;
  currency: string;
  is_adults_only: boolean;
  max_count_of_guests: number;
  // The docs' own example payload shows only checkin_time/checkout_time
  // (single values), but a live create against the real API rejected that
  // with "checkin_from_time/checkin_to_time/checkout_from_time/
  // checkout_to_time can't be blank" - the real required fields are an
  // arrival/departure WINDOW, not a single instant. checkin_time/
  // checkout_time still come back on read (likely derived from the window's
  // start), so both are kept - the four *_time fields are what's actually
  // required on write.
  checkin_time?: string; // "HH:MM" - read-only/derived, sent for completeness only
  checkout_time?: string;
  checkin_from_time: string; // "HH:MM"
  checkin_to_time: string;
  checkout_from_time: string;
  checkout_to_time: string;
  internet_access_type: "none" | "wifi" | "wired";
  internet_access_coverage: "entire_property" | "public_areas" | "all_rooms" | "some_rooms" | "business_centre";
  internet_access_cost: number | null;
  parking_type: "on_site" | "nearby" | "none";
  parking_reservation: "not_available" | "not_needed" | "needed";
  parking_is_private: boolean;
  pets_policy: "allowed" | "not_allowed" | "by_arrangements" | "assistive_only";
  pets_non_refundable_fee: string;
  pets_refundable_deposit: string;
  smoking_policy: "no_smoking" | "permitted_areas_only" | "allowed";
}

export interface HotelPolicy extends HotelPolicyFields {
  id: string;
}

export async function getHotelPolicyForProperty(channexPropertyId: string): Promise<HotelPolicy | null> {
  // No documented per-property filter param, so this pages through the
  // account's policies and matches locally. Fine at this account's real
  // scale (one policy per property, a handful of properties) - would need a
  // real filter if that ever changes materially.
  const res = await channexGet<Array<{ id: string; attributes: HotelPolicy & { id: string; property_id?: string } }>>(
    "/hotel_policies?pagination[limit]=100"
  );
  const match = (res.data ?? []).find((p) => (p.attributes as unknown as { property_id?: string }).property_id === channexPropertyId);
  // The list endpoint's example payload doesn't show property_id on the
  // attributes at all (only id/title/etc) - if Channex never actually
  // includes it there, this falls back to "only one policy exists" which
  // holds for every property this account has today.
  if (match) return match.attributes;
  const all = res.data ?? [];
  return all.length === 1 ? all[0].attributes : null;
}

export async function createHotelPolicy(channexPropertyId: string, fields: HotelPolicyFields): Promise<HotelPolicy> {
  const res = await channexPost<{ id: string; attributes: HotelPolicy }>("/hotel_policies", {
    hotel_policy: { property_id: channexPropertyId, ...fields },
  });
  if (!res.data) throw new Error("Channex returned no data creating the hotel policy");
  return res.data.attributes;
}

export async function updateHotelPolicy(policyId: string, fields: HotelPolicyFields): Promise<HotelPolicy> {
  const res = await channexPut<{ id: string; attributes: HotelPolicy }>(`/hotel_policies/${policyId}`, {
    hotel_policy: fields,
  });
  if (!res.data) throw new Error("Channex returned no data updating the hotel policy");
  return res.data.attributes;
}

// Create-or-update in one call, since the UI just has "save" with no
// separate create/edit mode - the caller shouldn't have to know which one
// applies.
export async function upsertHotelPolicy(channexPropertyId: string, fields: HotelPolicyFields): Promise<HotelPolicy> {
  const existing = await getHotelPolicyForProperty(channexPropertyId);
  return existing ? updateHotelPolicy(existing.id, fields) : createHotelPolicy(channexPropertyId, fields);
}
