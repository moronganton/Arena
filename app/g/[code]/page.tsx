import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

// Public guest photo page. Guests arrive here from a link in their
// Booking.com/Airbnb chat and have no StayHQ account, so this is
// unauthenticated by design. The short code is the capability, and the page
// shows only the host's own instruction photos — no guest, reservation or
// account data.
export const dynamic = "force-dynamic";

async function loadTemplate(code: string) {
  return prisma.messageTemplate.findUnique({
    where: { shareCode: code },
    select: {
      name: true,
      property: { select: { name: true } },
      images: { orderBy: { order: "asc" }, select: { id: true, fileName: true } },
    },
  });
}

// Booking.com and Airbnb sometimes render a preview card for a pasted link.
// Feeding them a title and the first photo is what turns the bare URL in the
// chat bubble into something that looks intentional.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const template = await loadTemplate(code);
  if (!template) return { title: "Photos" };

  const title = template.property?.name ? `Photos — ${template.property.name}` : "Photos from your host";
  const description = `${template.images.length} photo${template.images.length === 1 ? "" : "s"} to help you settle in.`;
  const first = template.images[0];

  return {
    title,
    description,
    robots: { index: false, follow: false }, // a guest link, not public web content
    openGraph: {
      title,
      description,
      type: "website",
      ...(first ? { images: [{ url: `/api/templates/images/${first.id}/raw` }] } : {}),
    },
  };
}

export default async function GuestPhotosPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const template = await loadTemplate(code);
  if (!template || template.images.length === 0) notFound();

  const heading = template.property?.name || "Your stay";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {template.images.length} photo{template.images.length === 1 ? "" : "s"} from your host to help you find your way.
          </p>
        </header>

        <div className="space-y-4">
          {template.images.map((img, i) => (
            <figure key={img.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Plain <img>: these are arbitrary host uploads served from our own
                  API route, so next/image optimisation buys nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/templates/images/${img.id}/raw`}
                alt={`Photo ${i + 1} of ${template.images.length}`}
                className="block w-full"
                loading={i === 0 ? "eager" : "lazy"}
              />
            </figure>
          ))}
        </div>

        <footer className="mt-8 text-center text-xs text-slate-400">
          Shared by your host · Please keep this link private
        </footer>
      </div>
    </main>
  );
}
