"use client";
import { useState } from "react";

// The property photo, with a fallback that is never a broken-image glyph.
//
// Properties created before the uploader hold an http(s) URL, and those rot -
// the link 404s or the host starts blocking hotlinks, and the page renders alt
// text in a photo-shaped hole. Falling back to the initial tile means a dead
// link degrades to the same placeholder an empty property shows, which reads
// as "no photo" rather than as a broken page.
export default function PropertyPhoto({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 ${className}`}
      >
        <span className="text-white text-3xl font-bold">{name[0]}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className={`rounded-xl object-cover shrink-0 ${className}`}
    />
  );
}
