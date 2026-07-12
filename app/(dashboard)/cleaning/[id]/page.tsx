"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Camera, Check, AlertTriangle, MapPin,
  RefreshCw, LogIn, LogOut, Trash2,
} from "lucide-react";

interface ChecklistEntry {
  category: string;
  label: string;
  done: boolean;
}

interface DamageReport {
  id: string;
  description: string;
  photos?: string;
  status: string;
  createdAt: string;
}

interface Task {
  id: string;
  status: string;
  scheduledDate: string;
  notes?: string;
  checkInAt?: string;
  checkInPhotos?: string;
  checkOutAt?: string;
  checkOutPhotos?: string;
  checklist?: string;
  property: { id: string; name: string; city: string; address: string };
  damageReports: DamageReport[];
}

// Compress a photo on the device before upload (max 1024px, JPEG 70%)
async function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function PhotoGrid({ photos }: { photos: string[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="flex gap-2 mt-3 overflow-x-auto">
      {photos.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={p} alt="" className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />
      ))}
    </div>
  );
}

export default function CleaningTaskPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [damageDesc, setDamageDesc] = useState("");
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [showDamageForm, setShowDamageForm] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cleaning/${id}`);
    if (res.ok) setTask(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePhotos(files: FileList | null, action: "checkin" | "checkout") {
    if (!files || files.length === 0) return;
    setBusy(action);
    try {
      const photos: string[] = [];
      for (const f of Array.from(files).slice(0, 5)) {
        photos.push(await compressPhoto(f));
      }
      const res = await fetch(`/api/cleaning/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, photos }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleItem(index: number) {
    if (!task?.checklist) return;
    const list: ChecklistEntry[] = JSON.parse(task.checklist);
    list[index] = { ...list[index], done: !list[index].done };
    setTask({ ...task, checklist: JSON.stringify(list) });
    await fetch(`/api/cleaning/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklist: list }),
    });
  }

  async function addDamagePhotos(files: FileList | null) {
    if (!files) return;
    setBusy("damage-photo");
    try {
      const next = [...damagePhotos];
      for (const f of Array.from(files).slice(0, 5 - next.length)) {
        next.push(await compressPhoto(f));
      }
      setDamagePhotos(next);
    } finally {
      setBusy(null);
    }
  }

  async function submitDamage() {
    if (!task || !damageDesc.trim()) return;
    setBusy("damage");
    const res = await fetch("/api/damages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: task.property.id,
        cleaningTaskId: task.id,
        description: damageDesc,
        photos: damagePhotos,
      }),
    });
    setBusy(null);
    if (res.ok) {
      setDamageDesc("");
      setDamagePhotos([]);
      setShowDamageForm(false);
      await load();
    }
  }

  async function deleteTask() {
    if (!confirm("Delete this cleaning task?")) return;
    await fetch(`/api/cleaning/${id}`, { method: "DELETE" });
    router.push("/cleaning");
  }

  if (!task) {
    return <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>;
  }

  const checklist: ChecklistEntry[] = task.checklist ? JSON.parse(task.checklist) : [];
  const categories = Array.from(new Set(checklist.map((c) => c.category)));
  const doneCount = checklist.filter((c) => c.done).length;
  const checkInPhotos: string[] = task.checkInPhotos ? JSON.parse(task.checkInPhotos) : [];
  const checkOutPhotos: string[] = task.checkOutPhotos ? JSON.parse(task.checkOutPhotos) : [];

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <Link href="/cleaning" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <button onClick={deleteTask} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-bold text-slate-900">{task.property.name}</h1>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            task.status === "COMPLETED" ? "bg-green-100 text-green-700"
            : task.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700"
            : "bg-amber-100 text-amber-700"
          }`}>
            {task.status.replace("_", " ")}
          </span>
        </div>
        <p className="text-sm text-slate-500 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          {task.property.address}, {task.property.city}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Scheduled: {new Date(task.scheduledDate).toLocaleDateString()}
        </p>
        {task.notes && (
          <div className="mt-3 p-3 bg-amber-50 rounded-xl text-sm text-amber-800">
            <strong>Note:</strong> {task.notes}
          </div>
        )}
      </div>

      {/* Step 1: Check-in */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <LogIn className="w-4 h-4 text-slate-500" />
          1. Arrival Check-In
        </h3>
        {task.checkInAt ? (
          <div className="mt-2">
            <p className="text-sm text-green-600 flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              Checked in at {new Date(task.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <PhotoGrid photos={checkInPhotos} />
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-slate-500 mb-3">
              Take photos of the apartment as you find it, then start cleaning.
            </p>
            <label className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-xl text-sm font-medium transition cursor-pointer">
              {busy === "checkin" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {busy === "checkin" ? "Uploading..." : "Take arrival photos & check in"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => handlePhotos(e.target.files, "checkin")}
                disabled={busy === "checkin"}
              />
            </label>
          </div>
        )}
      </div>

      {/* Step 2: Checklist */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-slate-900">2. Cleaning Checklist</h3>
          <span className="text-xs text-slate-500">{doneCount}/{checklist.length}</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-1.5 mb-4">
          <div
            className="bg-green-500 h-1.5 rounded-full transition-all"
            style={{ width: checklist.length ? `${(doneCount / checklist.length) * 100}%` : "0%" }}
          />
        </div>
        {categories.map((cat) => (
          <div key={cat} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{cat}</p>
            <div className="space-y-1.5">
              {checklist.map((item, i) =>
                item.category === cat ? (
                  <button
                    key={i}
                    onClick={() => toggleItem(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition ${
                      item.done ? "bg-green-50 text-slate-400 line-through" : "bg-slate-50 hover:bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                      item.done ? "bg-green-500 border-green-500" : "border-slate-300"
                    }`}>
                      {item.done && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    {item.label}
                  </button>
                ) : null
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Step 3: Damages */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-slate-500" />
          3. Report Damage
        </h3>

        {task.damageReports.length > 0 && (
          <div className="space-y-2 mb-4">
            {task.damageReports.map((d) => {
              const photos: string[] = d.photos ? JSON.parse(d.photos) : [];
              return (
                <div key={d.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-800">{d.description}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      d.status === "OPEN" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                    }`}>
                      {d.status}
                    </span>
                  </div>
                  <PhotoGrid photos={photos} />
                </div>
              );
            })}
          </div>
        )}

        {showDamageForm ? (
          <div className="space-y-3">
            <textarea
              value={damageDesc}
              onChange={(e) => setDamageDesc(e.target.value)}
              rows={2}
              placeholder="Describe the problem... e.g. Broken table leg in living room"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <PhotoGrid photos={damagePhotos} />
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-xl text-sm font-medium transition cursor-pointer">
                <Camera className="w-4 h-4" />
                {busy === "damage-photo" ? "Adding..." : "Add photo"}
                <input
                  type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={(e) => addDamagePhotos(e.target.files)}
                  disabled={busy === "damage-photo"}
                />
              </label>
              <button
                onClick={submitDamage}
                disabled={!damageDesc.trim() || busy === "damage"}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                {busy === "damage" ? "Sending..." : "Submit Report"}
              </button>
              <button
                onClick={() => { setShowDamageForm(false); setDamageDesc(""); setDamagePhotos([]); }}
                className="border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDamageForm(true)}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-red-200 hover:bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium transition"
          >
            <AlertTriangle className="w-4 h-4" />
            Report a damage or problem
          </button>
        )}
      </div>

      {/* Step 4: Check-out */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <LogOut className="w-4 h-4 text-slate-500" />
          4. Finish & Check-Out
        </h3>
        {task.checkOutAt ? (
          <div className="mt-2">
            <p className="text-sm text-green-600 flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              Completed at {new Date(task.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <PhotoGrid photos={checkOutPhotos} />
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-slate-500 mb-3">
              When cleaning is done, take photos of how you leave the apartment.
            </p>
            {!task.checkInAt && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                Check in first (step 1) before completing the task.
              </p>
            )}
            <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition cursor-pointer ${
              task.checkInAt
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}>
              {busy === "checkout" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {busy === "checkout" ? "Uploading..." : "Take final photos & complete"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => handlePhotos(e.target.files, "checkout")}
                disabled={!task.checkInAt || busy === "checkout"}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
