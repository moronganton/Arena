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
