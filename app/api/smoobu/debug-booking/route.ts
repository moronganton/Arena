import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { smoobuFetch } from "@/lib/channels/smoobu-core";

// Diagnostic (read-only): dumps the raw Smoobu reservation payload so we can
// see exactly which fields the account returns. StayHQ currently parses only a
// dozen of them, so anything Smoobu sends about the guest's language or country
// is being discarded — this shows whether it is there to use.
//
//   GET /api/smoobu/debug-booking              → most recent Smoobu booking
//   GET /api/smoobu/debug-booking?externalId=smoobu-12345
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const externalIdParam = new URL(req.url).searchParams.get("externalId");

  const reservation = await prisma.reservation.findFirst({
    where: {
      property: { ownerId: session.user.id },
      ...(externalIdParam
        ? { externalId: externalIdParam }
        : { externalId: { startsWith: "smoobu-" }, status: { not: "CANCELLED" } }),
    },
    orderBy: { createdAt: "desc" },
    include: { guest: { select: { name: true, language: true } } },
  });
  if (!reservation?.externalId) {
    return NextResponse.json({ error: "No Smoobu reservation found" }, { status: 404 });
  }

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  const smoobuId = reservation.externalId.replace("smoobu-", "");
  let raw: unknown;
  let fetchError: string | null = null;
  try {
    raw = await smoobuFetch(account.apiKey, `/reservations/${smoobuId}`);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  // Surface every key Smoobu sent, and flag the ones that look like a language
  // or country signal, so the answer does not depend on reading a long dump.
  const keys = raw && typeof raw === "object" ? Object.keys(raw as Record<string, unknown>) : [];
  const interesting = keys.filter((k) => /lang|locale|countr|nation|guest/i.test(k));
  const candidates: Record<string, unknown> = {};
  for (const k of interesting) candidates[k] = (raw as Record<string, unknown>)[k];

  return NextResponse.json({
    reservation: {
      guest: reservation.guest.name,
      storedLanguage: reservation.guest.language, // always "en" today — never populated
      externalId: reservation.externalId,
    },
    fetchError,
    languageOrCountryFields: candidates,
    allKeys: keys,
    raw,
  });
}
