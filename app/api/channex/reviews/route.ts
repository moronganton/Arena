import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { listReviewsForProperty, replyToReview, isReviewsAppNotInstalled } from "@/lib/channels/channex-reviews";
import { ChannexError } from "@/lib/channels/channex-core";

//   GET  /api/channex/reviews?propertyId=...
//   POST /api/channex/reviews   { propertyId, reviewId, reply }
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const reviews = await listReviewsForProperty(guard.channexPropertyId);
    return NextResponse.json({ property: guard.propertyName, reviews });
  } catch (err) {
    if (isReviewsAppNotInstalled(err)) {
      return NextResponse.json({ error: "The Messages & Reviews app isn't installed for this property on Channex" }, { status: 403 });
    }
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { propertyId, reviewId, reply } = body as { propertyId?: string; reviewId?: string; reply?: string };
  if (!propertyId || !reviewId || !reply?.trim()) {
    return NextResponse.json({ error: "propertyId, reviewId, and reply are required" }, { status: 400 });
  }

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Confirm the review actually belongs to this property before replying -
  // reviewId is an opaque Channex id, otherwise any Channex-property owner
  // could reply to any review on the account.
  const reviews = await listReviewsForProperty(guard.channexPropertyId);
  if (!reviews.some((r) => r.id === reviewId)) {
    return NextResponse.json({ error: "Review not found on this property" }, { status: 404 });
  }

  try {
    const review = await replyToReview(reviewId, reply.trim());
    return NextResponse.json({ property: guard.propertyName, review });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}
