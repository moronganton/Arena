import { channexGet, channexPut } from "./channex-core";

// Confirmed against the real docs: Channex's ~181-item facility catalog is
// read via a standalone collection (/property_facilities), but there is no
// standalone "assign facility to property" endpoint - a property's own
// facilities list is a field on the Property object itself
// (PUT /properties/:id { property: { facilities: [ids] } }), set as a full
// replacement, matching how Update Property documents every array field
// (facilities, content.photos) working.

export interface FacilityOption {
  id: string;
  category: string;
  title: string;
}

// Options endpoint returns the whole ~181-item catalog with no pagination -
// exactly what a checklist UI needs in one call, vs. the paginated List
// endpoint meant for browsing.
export async function listFacilityOptions(): Promise<FacilityOption[]> {
  const res = await channexGet<Array<{ id: string; attributes: FacilityOption }>>("/property_facilities/options");
  return (res.data ?? []).map((f) => f.attributes);
}

export async function getPropertyFacilityIds(channexPropertyId: string): Promise<string[]> {
  const res = await channexGet<{ attributes: { facilities?: string[] } }>(`/properties/${channexPropertyId}`);
  return res.data?.attributes.facilities ?? [];
}

// Full replacement, not additive - matches Channex's own semantics for this
// field. Callers must send the complete desired list.
export async function setPropertyFacilityIds(channexPropertyId: string, facilityIds: string[]): Promise<string[]> {
  const res = await channexPut<{ attributes: { facilities?: string[] } }>(`/properties/${channexPropertyId}`, {
    property: { facilities: facilityIds },
  });
  return res.data?.attributes.facilities ?? facilityIds;
}
