import { prisma } from "@/lib/prisma";

// The single ownership+eligibility check for every "Channex property content"
// feature added in this batch (Hotel Policy, Facilities, Photos, Reviews,
// Payments) - one place, reused everywhere, rather than four slightly
// different copies of the same three conditions.
//
// This is what makes all five features structurally incapable of touching
// the Bratislava/Smoobu properties, not merely careful not to: every one of
// these Channex API endpoints is scoped by a Channex property_id, and a
// property only has one (a ChannexListing row) once it has been explicitly
// migrated via /api/debug/migrate-to-channex - which Bratislava's two
// properties never have been, and this change does not touch. The
// channelProvider check below is the same belt-and-braces the rest of the
// Channex integration already uses (see ari-outbox.ts, channex-bookings.ts).
export interface ChannexPropertyGuardResult {
  ok: true;
  propertyName: string;
  channexPropertyId: string;
  channexRoomTypeId: string;
  channexRatePlanId: string;
  paymentInstallationId: string | null;
  paymentProviderId: string | null;
}

export type ChannexPropertyGuard =
  | ChannexPropertyGuardResult
  | { ok: false; status: number; error: string };

export async function requireChannexProperty(propertyId: string, ownerId: string): Promise<ChannexPropertyGuard> {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId },
    select: {
      name: true,
      channelProvider: true,
      channexListing: {
        select: {
          channexPropertyId: true,
          channexRoomTypeId: true,
          channexRatePlanId: true,
          paymentInstallationId: true,
          paymentProviderId: true,
        },
      },
    },
  });
  if (!property) return { ok: false, status: 404, error: "Property not found" };
  if (property.channelProvider !== "CHANNEX" || !property.channexListing) {
    return { ok: false, status: 400, error: `${property.name} isn't on Channex` };
  }
  return {
    ok: true,
    propertyName: property.name,
    channexPropertyId: property.channexListing.channexPropertyId,
    channexRoomTypeId: property.channexListing.channexRoomTypeId,
    channexRatePlanId: property.channexListing.channexRatePlanId,
    paymentInstallationId: property.channexListing.paymentInstallationId,
    paymentProviderId: property.channexListing.paymentProviderId,
  };
}
