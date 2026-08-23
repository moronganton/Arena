import { prisma } from "@/lib/prisma";
import { quoteCityTax, chargeSavedCard } from "@/lib/city-tax";
import { notifyUser } from "@/lib/notify";

// The "auto-charge" half of the toggle: runs on the same hourly cron cycle
// as the template scheduler, not immediately when a card is saved - a card
// saved this hour gets charged within the hour, and a failure (e.g. the
// bank requires interactive authentication for this charge, which an
// off-session PaymentIntent cannot satisfy) has a natural next-run retry
// point rather than needing bespoke retry logic of its own.
//
// Only ever touches a reservation whose property has cityTaxAutoChargeEnabled
// - everything here is inert for every property until a host turns it on,
// same guarantee the merge field resolver gives on the send side.
export interface CityTaxAutoChargeResult {
  checked: number;
  charged: number;
  failed: number;
  errors: string[];
}

// A permanent record of a failed attempt, distinct from PENDING (a live
// payment link still awaiting the guest) - so the next run's query can skip
// it instead of retrying an off-session charge that will fail the exact
// same way every time, and so the city-tax report shows "needs attention"
// rather than "awaiting payment" for it.
const FAILED_STATUS = "FAILED";

export async function runCityTaxAutoCharge(): Promise<CityTaxAutoChargeResult> {
  const result: CityTaxAutoChargeResult = { checked: 0, charged: 0, failed: 0, errors: [] };

  const candidates = await prisma.reservation.findMany({
    where: {
      status: { not: "CANCELLED" },
      property: { cityTaxAutoChargeEnabled: true, cityTaxPerNight: { not: null } },
      guestCardOnFile: { status: "SAVED" },
      cityTaxCharges: { none: { status: { in: ["PAID", FAILED_STATUS] } } },
    },
    include: { property: true, guest: { select: { name: true } } },
    take: 100,
  });

  for (const r of candidates) {
    result.checked++;
    const quote = quoteCityTax(r.property, r);
    if (!quote || quote.amountCents <= 0) continue;

    try {
      await chargeSavedCard(r.id, quote.amountCents, `City tax — ${r.property.name} (auto)`);
      result.charged++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed++;
      result.errors.push(`${r.id}: ${message}`);
      console.error(`[city-tax-auto-charge] reservation ${r.id} failed:`, err);

      // Recorded as its own charge row (not just a log line) so it shows up
      // in the city-tax report, and so this candidate query excludes it on
      // the next run - retrying an off-session charge that needs guest
      // interaction would just fail identically forever.
      await prisma.cityTaxCharge.create({
        data: {
          reservationId: r.id,
          amountCents: quote.amountCents,
          currency: quote.currency,
          guests: quote.guests,
          nights: quote.nights,
          perNightCents: quote.perNightCents,
          status: FAILED_STATUS,
        },
      });

      await notifyUser(r.property.ownerId, {
        type: "delivery_failed",
        title: `City tax auto-charge failed — ${r.property.name}`,
        body: `Couldn't automatically charge ${r.guest.name}'s saved card (${message}). Charge it manually from the reservation, or send a new card link.`,
        link: `/reservations/${r.id}`,
      });
    }
  }

  return result;
}
