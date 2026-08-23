import { channexGet, channexPost, channexPut, channexDelete } from "./channex-core";

// Channex's Tax object - confirmed live against the real API (docs.channex.io
// is blocked from this sandbox, same as every other Channex collection built
// this way): POST /taxes with {title, currency, property_id, rate, logic}
// required; type/is_inclusive/max_nights/skip_nights/applicable_* all real
// fields on the object, confirmed via create-and-read-back. Every enum value
// StayHQ's own UI offers is confirmed against the live API too, not just the
// dashboard's dropdown labels - "city_tax"/"per_person_per_night" via the
// original create, "fee"/"per_booking" via a dedicated round-trip probe
// (create, read back, delete) - the rest inferred from the 100% consistent
// snake_case pattern every other Channex enum in this codebase follows.
//
// This is Channex's OTA-facing tax DISCLOSURE, not a payment mechanism -
// creating one here does not charge anyone. It's what makes Booking.com show
// "excludes 3.50 EUR city tax per person/night" on the listing. StayHQ's own
// money collection (lib/city-tax.ts) is a completely separate Stripe flow,
// which now reads the same title/logic/rate to compute what it actually
// charges - see quoteCityTax.
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

export interface CityTaxSyncFields {
  title: string;
  currency: string;
  type: string;
  logic: string;
  isInclusive: boolean;
  rate: number;
  maxNights: number | null;
  skipNights: number | null;
}

export async function getChannexTaxById(taxId: string): Promise<ChannexTax | null> {
  try {
    const res = await channexGet<{ id: string; attributes: ChannexTax }>(`/taxes/${taxId}`);
    return res.data ? { ...res.data.attributes, id: res.data.id } : null;
  } catch {
    return null; // deleted or otherwise gone - treated as "nothing to update"
  }
}

// No documented per-property filter, so - same approach as Hotel Policy -
// this lists and matches locally. Only used to ADOPT a tax that already
// existed before this sync did (Sinteu's real one, created by hand in
// Channex); every sync after that goes by id (see getChannexTaxById), which
// is immune to the host later changing type/title on either side.
export async function findExistingCityTax(channexPropertyId: string, type: string): Promise<ChannexTax | null> {
  const res = await channexGet<Array<{ id: string; attributes: ChannexTax; relationships?: { property?: { data?: { id?: string } } } }>>(
    "/taxes?pagination[limit]=100"
  );
  const match = (res.data ?? []).find(
    (t) => t.relationships?.property?.data?.id === channexPropertyId && t.attributes.type === type
  );
  return match ? { ...match.attributes, id: match.id } : null;
}

// StayHQ owns title/currency/type/logic/is_inclusive/rate/max_nights/
// skip_nights now - all pushed on every save, not merged with what's already
// there. applicable_after/applicable_before/applicable_date_ranges (seasonal
// date ranges) have no StayHQ UI yet, so those alone are preserved from the
// existing object rather than reset to blank on every update.
//
// existingTaxId: the caller's stored Property.cityTaxChannexId, if any -
// pass null on the very first sync for a property (or one that predates
// this field) to fall back to the by-type lookup once. Always returns the
// tax's id so the caller can persist it for every sync after this one.
export async function upsertCityTax(
  channexPropertyId: string,
  existingTaxId: string | null,
  fields: CityTaxSyncFields
): Promise<ChannexTax> {
  const existing = existingTaxId
    ? await getChannexTaxById(existingTaxId)
    : await findExistingCityTax(channexPropertyId, fields.type);

  const payload = {
    title: fields.title,
    currency: fields.currency,
    type: fields.type,
    logic: fields.logic,
    is_inclusive: fields.isInclusive,
    rate: fields.rate.toFixed(2),
    max_nights: fields.maxNights,
    skip_nights: fields.skipNights,
  };

  if (existing) {
    const res = await channexPut<{ id: string; attributes: ChannexTax }>(`/taxes/${existing.id}`, {
      tax: {
        ...payload,
        applicable_after: existing.applicable_after,
        applicable_before: existing.applicable_before,
        applicable_date_ranges: existing.applicable_date_ranges,
      },
    });
    if (!res.data) throw new Error("Channex returned no data updating the city tax");
    return { ...res.data.attributes, id: res.data.id };
  }

  const res = await channexPost<{ id: string; attributes: ChannexTax }>("/taxes", {
    tax: { ...payload, property_id: channexPropertyId },
  });
  if (!res.data) throw new Error("Channex returned no data creating the city tax");
  return { ...res.data.attributes, id: res.data.id };
}

export async function deleteChannexTax(taxId: string): Promise<void> {
  await channexDelete(`/taxes/${taxId}`);
}
