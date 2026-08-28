"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { compressImage, dataUrlBytes, isAcceptableImageSrc } from "@/lib/image";

// Picking the property's photo from the device instead of pasting a URL.
//
// Pasting a URL was the old input and it had the failure mode you would
// expect: the link rots, or points somewhere that blocks hotlinking, and the
// property page renders alt text where a photo should be. An uploaded image
// is compressed on the device and stored inline, so it cannot break later.
//
// Properties created before this still hold http(s) URLs, which stay valid -
// the preview renders them the same way, and only replacing one converts it.

export default function PropertyImageInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stored URL can 404 or block hotlinking; a stored data URL cannot. Either
  // way the preview should say so rather than showing a broken-image glyph.
  const [broken, setBroken] = useState(false);

  async function accept(file: File) {
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      if (!isAcceptableImageSrc(dataUrl)) {
        setError("That image is too large even after compressing. Try a smaller one.");
        return;
      }
      setBroken(false);
      onChange(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  const isUploaded = value.startsWith("data:");
  const sizeKb = isUploaded ? Math.round(dataUrlBytes(value) / 1024) : null;

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">Photo</label>

      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-40 h-28 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
          {value && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Property"
              className="w-full h-full object-cover"
              onError={() => setBroken(true)}
              onLoad={() => setBroken(false)}
            />
          ) : (
            <span className="text-xs text-slate-400 text-center px-2">
              {broken ? "Image unavailable" : "No photo yet"}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {busy ? "Processing…" : value ? "Replace photo" : "Upload photo"}
            </button>
            {value && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => {
                  setBroken(false);
                  setError(null);
                  onChange("");
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-200 px-3 py-2 rounded-xl transition"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 max-w-xs">
            {isUploaded
              ? `Stored in host24 · about ${sizeKb} KB. Resized to 1024px on your device before saving.`
              : broken
                ? "This property still points at a web address that isn't loading. Upload a photo to replace it."
                : value
                  ? "This property still uses a web address. Uploading a photo replaces it with one that can't break."
                  : "JPG, PNG or WebP. It's resized on your device, so a large phone photo is fine."}
          </p>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
          // Cleared so picking the same file twice still fires a change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
