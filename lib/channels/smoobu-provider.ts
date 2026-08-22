import { prisma } from "@/lib/prisma";
import type { ChannelProvider } from "./provider";
import { syncSmoobuBookings, syncUserSmoobuMessages } from "./smoobu";
import {
  syncSmoobuMessagesForReservation,
  sendSmoobuGuestMessage,
  getSmoobuRates,
  getSmoobuRatesMulti,
} from "./smoobu-core";

// Thin wrapper - every method below just forwards to the existing, already-
// battle-tested smoobu.ts / smoobu-core.ts functions. No behaviour changes
// here; this file exists so call sites depend on the ChannelProvider
// interface instead of importing Smoobu-specific functions directly.
export const smoobuProvider: ChannelProvider = {
  name: "SMOOBU",
  syncBookings: syncSmoobuBookings,
  syncMessages: syncUserSmoobuMessages,
  syncMessagesForReservation: syncSmoobuMessagesForReservation,
  sendGuestMessage: sendSmoobuGuestMessage,
  getRates: getSmoobuRates,
  getRatesMulti: getSmoobuRatesMulti,
  // Smoobu has no API for StayHQ to push availability/pricing TO - it pulls
  // from its own connected channels instead. Real work starts with Channex.
  async pushAri() {},
};

// Every property is SMOOBU today - Property.channelProvider doesn't exist as
// a column yet (that's the next step in the Channex plan), and there is no
// second ChannelProvider implementation until Channex is built. This
// resolves unconditionally to Smoobu for exactly that reason: not a
// shortcut, the honest state of the migration right now. Once the schema
// flag lands, swap the body for a real Property.channelProvider lookup - no
// call site that uses this needs to change again.
export async function getProviderForProperty(_propertyId: string): Promise<ChannelProvider> {
  return smoobuProvider;
}

// Every provider this account has properties on. Used by account-scoped
// syncs where a host with properties split across providers should run both
// - today that's always just Smoobu, or nothing if not connected.
export async function getProvidersForUser(userId: string): Promise<ChannelProvider[]> {
  const account = await prisma.smoobuAccount.findUnique({ where: { userId }, select: { userId: true } });
  return account ? [smoobuProvider] : [];
}

// The account-looping body behind both GET /api/cron/sync-reservations and
// its Railway-cron script equivalent (scripts/cron/sync-reservations.ts) -
// pulled out here so there is exactly one implementation calling
// smoobuProvider.syncBookings for every connected account, not two that can
// drift apart.
export async function syncAllSmoobuReservations(): Promise<{
  accounts: number;
  imported: number;
  updated: number;
  cancelled: number;
  errors: string[];
}> {
  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const r = await smoobuProvider.syncBookings(account.userId);
      imported += r.imported;
      updated += r.updated;
      cancelled += r.cancelled;
      if (r.errors.length) errors.push(...r.errors.map((e) => `${account.userId}: ${e}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[smoobu-sync-all] account ${account.userId} failed:`, err);
      errors.push(`${account.userId}: ${msg}`);
    }
  }

  return { accounts: accounts.length, imported, updated, cancelled, errors };
}

// Same idea for GET /api/cron/sync-messages.
export async function syncAllSmoobuMessages(): Promise<{
  accounts: number;
  reservationsChecked: number;
  newMessages: number;
  errors: string[];
}> {
  const accounts = await prisma.smoobuAccount.findMany({ select: { userId: true } });

  let reservationsChecked = 0;
  let newMessages = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const r = await smoobuProvider.syncMessages(account.userId);
      reservationsChecked += r.checked;
      newMessages += r.newMessages;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[smoobu-sync-all] account ${account.userId} failed:`, err);
      errors.push(`${account.userId}: ${msg}`);
    }
  }

  return { accounts: accounts.length, reservationsChecked, newMessages, errors };
}
