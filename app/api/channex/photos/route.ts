import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireChannexProperty } from "@/lib/channels/channex-property-guard";
import { uploadChannexPhoto, listPropertyPhotos, createPropertyPhoto, deleteChannexPhoto } from "@/lib/channels/channex-photos";
import { ChannexError } from "@/lib/channels/channex-core";

//   GET    /api/channex/photos?propertyId=...
//   POST   /api/channex/photos   { propertyId, dataUrl, description? }  - upload + create in one call
//   DELETE /api/channex/photos   { propertyId, photoId }
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = new URL(req.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const photos = await listPropertyPhotos(guard.channexPropertyId);
    return NextResponse.json({ property: guard.propertyName, photos });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { propertyId, dataUrl, description } = body as { propertyId?: string; dataUrl?: string; description?: string };
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!dataUrl) return NextResponse.json({ error: "dataUrl is required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const [tempUrl, existing] = await Promise.all([
      uploadChannexPhoto(dataUrl),
      listPropertyPhotos(guard.channexPropertyId),
    ]);
    // New photos append to the end - position 0 is the cover photo, and an
    // upload should never silently displace whichever photo the host chose
    // as cover.
    const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((p) => p.position)) + 1;
    const photo = await createPropertyPhoto(guard.channexPropertyId, { url: tempUrl, position: nextPosition, description });
    return NextResponse.json({ property: guard.propertyName, photo }, { status: 201 });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status || 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { propertyId, photoId } = body as { propertyId?: string; photoId?: string };
  if (!propertyId || !photoId) return NextResponse.json({ error: "propertyId and photoId are required" }, { status: 400 });

  const guard = await requireChannexProperty(propertyId, session.user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Confirm the photo actually belongs to this property before deleting -
  // photoId is an opaque Channex id, and without this a caller could delete
  // any photo id on the account just by guessing one, as long as they own
  // *some* Channex property.
  const photos = await listPropertyPhotos(guard.channexPropertyId);
  if (!photos.some((p) => p.id === photoId)) {
    return NextResponse.json({ error: "Photo not found on this property" }, { status: 404 });
  }

  try {
    await deleteChannexPhoto(photoId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const e = err as ChannexError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}
