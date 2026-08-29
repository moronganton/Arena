import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { readRatePlansFromChannel } from "@/lib/channels/channex-channel-read";

// Reads the rate plans a property ALREADY sells, from the channel itself.
//
// The alternative this replaces is asking an operator to retype their whole
// rate structure into host24 from memory, or to screenshot it and hope a model
// reads the names right. Neither is necessary for the part that matters:
// Booking.com sends Channex the room types, plan names, ids and parent/child
// links on every connection. Only the numbers - percentage, minimum stay,
// cancellation policy - are genuinely absent, and those are exactly what the
// review screen asks a human to confirm anyway.
//
// Creates nothing. mapping_details is a read despite its verb, and
// provisioning still happens afterwards from whatever the operator approved.
//
//   POST /api/channex/rate-plans/read-from-channel   { propertyId }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const propertyId = body?.propertyId as string | undefined;
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  // Ownership and eligibility in one check. This is also what keeps the
  // feature structurally unable to touch a Smoobu-managed property: no
  // ChannexListing row, no Channex property id, no call.
  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const result = await readRatePlansFromChannel(guard.channexPropertyId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { ok, channelId, ...payload } = result;
  void ok;
  void channelId;
  return NextResponse.json(payload);
}
