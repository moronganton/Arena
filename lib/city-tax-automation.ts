import { prisma } from "@/lib/prisma";
import { quoteCityTax, chargeSavedCard } from "@/lib/city-tax";
import { notifyUser } from "@/lib/notify";
import { channexBookingIdFromExternalId } from "@/lib/channels/channex-messages";
import { listPaymentTransactions } from "@/lib/channels/channex-payments";

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
  skipped: number;
  errors: string[];
}

// A permanent record of a failed attempt, distinct from PENDING (a live
// payment link still awaiting the guest) - so the next run's query can skip
// it instead of retrying an off-session charge that will fail the exact
// same way every time, and so the city-tax report shows "needs attention"
// rather than "awaiting payment" for it.
const FAILED_STATUS = "FAILED";
// A deliberate hold-back, not a failure - "Charge card (via Channex)" is a
// second, completely separate charging mechanism (see PaymentsCard.tsx) that
// never writes a CityTaxCharge row, so this job has no way to see a city tax
// payment collected that way. Recorded so a host reviews it once rather than
// this job silently double-charging the guest.
const SKIPPED_STATUS = "SKIPPED";

export async function runCityTaxAutoCharge(): Promise<CityTaxAutoChargeResult> {
  const result: CityTaxAutoChargeResult = { checked: 0, charged: 0, failed: 0, skipped: 0, errors: [] };

  const candidates = await prisma.reservation.findMany({
    where: {
      status: { not: "CANCELLED" },
      property: { cityTaxAutoChargeEnabled: true, cityTaxPerNight: { not: null } },
      guestCardOnFile: { status: "SAVED" },
      cityTaxCharges: { none: { status: { in: ["PAID", FAILED_STATUS, SKIPPED_STATUS] } } },
    },
    include: { property: { include: { channexListing: true } }, guest: { select: { name: true } } },
    take: 100,
  });

  for (const r of candidates) {
    result.checked++;
    const quote = quoteCityTax(r.property, r);
    if (!quote || quote.amountCents <= 0) continue;

    // Cross-check Channex's own payment ledger before ever touching the
    // saved card. Any charge already on this booking is enough to hold
    // back - not just ones that look like city tax - since a free-text
    // description ("Late check-in", "City tax", nothing at all) is not a
    // reliable way to tell them apart, and skipping one that turns out
    // unrelated costs a host a quick manual check, while charging the
    // guest twice for city tax does not undo itself the same way.
    const bookingId = r.externalId ? channexBookingIdFromExternalId(r.externalId) : null;
    const installationId = r.property.channexListing?.paymentInstallationId;
    if (bookingId && installationId) {
      try {
        const transactions = await listPaymentTransactions(installationId);
        const alreadyCharged = transactions.some((t) => t.booking_id === bookingId && t.type === "charge");
        if (alreadyCharged) {
          result.skipped++;
          await prisma.cityTaxCharge.create({
            data: {
              reservationId: r.id,
              amountCents: quote.amountCents,
              currency: quote.currency,
              guests: quote.guests,
              nights: quote.nights,
              perNightCents: quote.perNightCents,
              status: SKIPPED_STATUS,
            },
          });
          await notifyUser(r.property.ownerId, {
            type: "info",
            title: `City tax auto-charge held back — ${r.property.name}`,
            body: `${r.guest.name}'s card is saved and ready to auto-charge, but a charge already exists on this booking's Channex payment history. Held off rather than risk charging city tax twice - check the reservation and charge manually if it's still owed.`,
            link: `/reservations/${r.id}`,
          });
          continue;
        }
      } catch (err) {
        // Can't confirm either way - err toward caution and skip this run
        // rather than risk a double charge because Channex's own API
        // hiccupped. Not recorded as SKIPPED (that status means "confirmed
        // another charge exists"), so a clean run next cycle can still
        // proceed normally once Channex is reachable again.
        console.error(`[city-tax-auto-charge] couldn't check Channex payment history for reservation ${r.id}:`, err);
        continue;
      }
    }

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
