import { channexGet, channexPost, channexPut, channexDelete } from "./channex-core";

// Channex's Tax object - confirmed live against the real API (docs.channex.io
// is blocked from this sandbox, same as every other Channex collection built
// this way): POST /taxes with {title, currency, property_id, rate, logic}
// required; type/is_inclusive/max_nights/skip_nights/applicable_* all real
// fields on the object, confirmed via create-and-read-back. No documented
// per-property filter, so - same approach as Hotel Policy - this lists and
// matches locally.
//
// This is Channex's OTA-facing tax DISCLOSURE, not a payment mechanism -
// creating one here does not charge anyone. It's what makes Booking.com show
// "excludes 3.50 EUR city tax per person/night" on the listing. StayHQ's own
// money collection (lib/city-tax.ts) is a completely separate Stripe flow.
export interface ChannexTax {
  id: string;
  title: string;
  currency: string;
  type: string;
  logic: string;
  is_inclusive: boolean;
  rate: string;
  max_nights: number | null;
  skip_nights: number | null;
  applicable_after: string | null;
  applicable_before: string | null;
  applicable_date_ranges: unknown[];
}

const CITY_TAX_TYPE = "city_tax";

export async function getCityTaxForProperty(channexPropertyId: string): Promise<ChannexTax | null> {
  const res = await channexGet<Array<{ id: string; attributes: ChannexTax; relationships?: { property?: { data?: { id?: string } } } }>>(
    "/taxes?pagination[limit]=100"
  );
  const match = (res.data ?? []).find(
    (t) => t.relationships?.property?.data?.id === channexPropertyId && t.attributes.type === CITY_TAX_TYPE
  );
  return match ? { ...match.attributes, id: match.id } : null;
}

// Only ever touches the fields StayHQ actually owns (rate, currency) - title/
// logic/is_inclusive get sensible defaults on first create, but are left
// exactly as they are on every later update, and max_nights/skip_nights/
// applicable_* are preserved untouched. A host who fine-tunes those directly
// in Channex (as this account already has - Max nights: 60 on Sinteu's real
// tax, set before this sync existed) must not have that silently reset every
// time StayHQ pushes a rate change.
export async function upsertCityTax(channexPropertyId: string, currency: string, ratePerNightPerPerson: number): Promise<ChannexTax> {
  const existing = await getCityTaxForProperty(channexPropertyId);
  const rate = ratePerNightPerPerson.toFixed(2);

  if (existing) {
    const res = await channexPut<{ id: string; attributes: ChannexTax }>(`/taxes/${existing.id}`, {
      tax: { ...existing, currency, rate },
    });
    if (!res.data) throw new Error("Channex returned no data updating the city tax");
    return res.data.attributes;
  }

  const res = await channexPost<{ id: string; attributes: ChannexTax }>("/taxes", {
    tax: {
      property_id: channexPropertyId,
      title: "City tax",
      currency,
      type: CITY_TAX_TYPE,
      logic: "per_person_per_night",
      is_inclusive: false,
      rate,
    },
  });
  if (!res.data) throw new Error("Channex returned no data creating the city tax");
  return res.data.attributes;
}

export async function deleteCityTaxForProperty(channexPropertyId: string): Promise<void> {
  const existing = await getCityTaxForProperty(channexPropertyId);
  if (!existing) return;
  await channexDelete(`/taxes/${existing.id}`);
}
