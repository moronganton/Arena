// The shared contract every channel manager integration implements. Smoobu
// is the first (and, until Channex lands in a later step) only
// implementation - see smoobu-provider.ts. The point of this interface is
// that Channex becomes a second implementation later without any of the 9
// call sites that dispatch through it needing to change again.

export interface DayRate {
  price: number | null;
  minStay: number | null;
  available: number | null;
}
export type RateMap = Record<string, DayRate>; // date (YYYY-MM-DD) -> DayRate

export interface BookingSyncResult {
  imported: number;
  updated: number;
  cancelled: number;
  errors: string[];
}

export interface MessageSyncResult {
  checked: number;
  newMessages: number;
}

export interface ChannelProvider {
  readonly name: "SMOOBU" | "CHANNEX";

  // Account-scoped: syncs every property this account has mapped to this
  // provider. An account with properties split across providers during
  // migration runs both - see getProvidersForUser in smoobu-provider.ts.
  syncBookings(userId: string): Promise<BookingSyncResult>;
  syncMessages(userId: string, limit?: number): Promise<MessageSyncResult>;

  // Reservation-scoped.
  syncMessagesForReservation(
    userId: string,
    reservation: { id: string; externalId: string | null }
  ): Promise<string[]>; // ids of newly-imported inbound messages
  sendGuestMessage(userId: string, reservationExternalId: string, body: string): Promise<boolean>;

  // Property-scoped, dispatched via getProviderForProperty.
  //
  // pushAri only does real work for a provider StayHQ pushes availability TO
  // - Smoobu pulls from its own connected channels instead, so its
  // implementation is a no-op. Real work starts with Channex's ARI outbox.
  pushAri(propertyId: string, from: Date, to: Date): Promise<void>;

  // Reads the provider's own live rate calendar (set by whatever manages
  // pricing there, e.g. PriceLabs). This is a Smoobu-shaped concern - Channex
  // properties will read pricing from StayHQ's own PricingRule model instead,
  // since with Channex StayHQ is the source of truth pushing rates OUT, not
  // pulling them in. Kept on the interface because Smoobu is the only
  // implementation for now; revisit when Channex's rates story is built.
  getRates(userId: string, listingId: string, startDate: string, endDate: string): Promise<RateMap>;
  getRatesMulti(
    userId: string,
    listingIds: string[],
    startDate: string,
    endDate: string
  ): Promise<Record<string, RateMap>>;
}
