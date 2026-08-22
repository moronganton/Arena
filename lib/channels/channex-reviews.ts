import { channexGet, channexPost, ChannexError } from "./channex-core";

// Confirmed against the real docs: reviews need the "Messages & Reviews" app
// installed on the property (same app already active for guest messaging -
// see channex-messages.ts), otherwise every call here 403s. A unified read
// across Airbnb/Expedia/Booking.com, reply-only (no create/delete - a review
// is the OTA's record, not ours to remove).

export interface ChannexReviewScore {
  category: string;
  score: number;
}

export interface ChannexReview {
  id: string;
  content: string;
  guest_name: string;
  inserted_at: string;
  received_at: string;
  is_hidden: boolean;
  is_replied: boolean;
  ota: string;
  ota_reservation_id: string;
  overall_score: number;
  reply: string | null;
  scores: ChannexReviewScore[];
  propertyId: string | null; // flattened from relationships.property.data.id
}

interface RawReview {
  id: string;
  attributes: Omit<ChannexReview, "id" | "propertyId">;
  relationships?: { property?: { data?: { id?: string } } };
}

export async function listReviewsForProperty(channexPropertyId: string): Promise<ChannexReview[]> {
  // No documented per-property filter, same situation as hotel_policies -
  // fetch and filter locally by the relationship, which every review does
  // carry (confirmed in the docs' own example payload).
  const res = await channexGet<RawReview[]>("/reviews?pagination[limit]=100");
  return (res.data ?? [])
    .map((r) => ({ id: r.id, ...r.attributes, propertyId: r.relationships?.property?.data?.id ?? null }))
    .filter((r) => r.propertyId === channexPropertyId)
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
}

export async function replyToReview(reviewId: string, reply: string): Promise<ChannexReview> {
  const res = await channexPost<RawReview>(`/reviews/${reviewId}/reply`, { reply: { reply } });
  if (!res.data) throw new Error("Channex returned no data replying to the review");
  return { id: res.data.id, ...res.data.attributes, propertyId: res.data.relationships?.property?.data?.id ?? null };
}

// 403 here means "Messages & Reviews" isn't installed - a distinct,
// actionable state from every other error, worth its own type guard so
// routes can surface it clearly instead of a generic 502.
export function isReviewsAppNotInstalled(err: unknown): boolean {
  return err instanceof ChannexError && err.status === 403;
}
