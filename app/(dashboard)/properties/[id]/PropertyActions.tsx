"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

export default function PropertyActions({
  id,
  // False when the property holds reservations, expenses, costs or damage
  // reports. Deleting it would take those with it, so only deactivation is
  // offered - and the dialog says which records, rather than leaving someone
  // to discover the reason by pressing a button that fails.
  canDelete = false,
  holds = null,
}: {
  id: string;
  canDelete?: boolean;
  holds?: string | null;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(purge: boolean) {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/properties/${id}${purge ? "?purge=true" : ""}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      router.push("/properties");
      router.refresh();
    } else {
      setDeleting(false);
      setError(data?.error ?? "Couldn't remove this property.");
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href={`/properties/${id}/edit`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium transition"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </Link>
        <button
          onClick={() => setShowConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Remove this property?</h3>

            {/* Two genuinely different outcomes, so they are two buttons rather
                than one word meaning either. Hiding is reversible and keeps
                every record; deleting is not and takes the property off the
                channel manager too. */}
            <p className="text-slate-600 text-sm">
              <strong>Hide it</strong> to stop it appearing in your listings. Nothing is lost and you
              can bring it back.
            </p>
            <p className="text-slate-600 text-sm mt-2">
              {canDelete ? (
                <>
                  <strong>Delete permanently</strong> removes it from host24 and from your channel
                  manager. This one cannot be undone.
                </>
              ) : (
                <>
                  It can&apos;t be deleted permanently: it still has{" "}
                  <strong>{holds}</strong>, and deleting it would take those with it.
                </>
              )}
            </p>

            {error && (
              <p className="mt-3 text-sm px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={() => handleDelete(false)}
                disabled={deleting}
                className="w-full bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition"
              >
                {deleting ? "Working…" : "Hide it from my listings"}
              </button>
              {canDelete && (
                <button
                  onClick={() => {
                    if (!confirm("Delete this property permanently? This cannot be undone.")) return;
                    handleDelete(true);
                  }}
                  disabled={deleting}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition"
                >
                  {deleting ? "Working…" : "Delete permanently"}
                </button>
              )}
              <button
                onClick={() => { setShowConfirm(false); setError(null); }}
                className="w-full border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
