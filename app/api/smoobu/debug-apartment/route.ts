import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { smoobuFetch } from "@/lib/channels/smoobu-core";

// Diagnostic (read-only): dumps the raw Smoobu apartment payload.
//
// Today StayHQ only reads `id`, `name` from the apartment list and `currency`
// / `location.currency` from the per-apartment detail (lib/channels/smoobu.ts).
// Everything else Smoobu sends about the listing — address, room counts,
// photos, whatever else lives under `location` — is currently discarded. This
// shows what is actually there before building an "import property from
// Smoobu" feature on top of guessed field names.
//
//   GET /api/smoobu/debug-apartment                    → first mapped apartment
//   GET /api/smoobu/debug-apartment?apartmentId=12345  → a specific one
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  const account = await prisma.smoobuAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) return NextResponse.json({ error: "Smoobu not connected" }, { status: 400 });

  let apartmentId = new URL(req.url).searchParams.get("apartmentId");

  let listRaw: unknown = null;
  let listError: string | null = null;
  if (!apartmentId) {
    try {
      listRaw = await smoobuFetch(account.apiKey, "/apartments");
      const list = ((listRaw as Record<string, unknown>)?.apartments ?? listRaw ?? []) as Array<{ id: number }>;
      apartmentId = list[0] ? String(list[0].id) : null;
    } catch (err) {
      listError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!apartmentId) {
    return NextResponse.json({ error: "No apartment found to inspect", listError, listRaw }, { status: 404 });
  }

  let detail: unknown;
  let detailError: string | null = null;
  try {
    detail = await smoobuFetch(account.apiKey, `/apartments/${apartmentId}`);
  } catch (err) {
    detailError = err instanceof Error ? err.message : String(err);
  }

  // Surface every top-level key, and flag the ones that look useful for
  // pre-filling a StayHQ property (address, rooms, guests, photos, description),
  // so the answer doesn't depend on reading the whole dump by eye.
  const keys = detail && typeof detail === "object" ? Object.keys(detail as Record<string, unknown>) : [];
  const interesting = keys.filter((k) =>
    /address|street|city|country|zip|postal|room|bed|bath|guest|occup|photo|image|picture|descri|name|location/i.test(
      k
    )
  );
  const candidates: Record<string, unknown> = {};
  for (const k of interesting) candidates[k] = (detail as Record<string, unknown>)[k];

  return NextResponse.json({
    apartmentId,
    detailError,
    likelyUsefulFields: candidates,
    allTopLevelKeys: keys,
    detail,
  });
}
