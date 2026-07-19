"use client";
import { useState, useEffect, useCallback } from "react";
import { Lightbulb, Camera, X, Send, RefreshCw, Check, Trash2 } from "lucide-react";

interface FeedbackItem {
  id: string;
  message: string;
  screenshots?: string | null;
  status: string;
  createdAt: string;
}

// Compress a screenshot on the device before upload (max 1600px, JPEG 80%)
async function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = url;
  });
}

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-indigo-100 text-indigo-700",
  REVIEWED: "bg-amber-100 text-amber-700",
  DONE: "bg-green-100 text-green-700",
};

export default function IdeasPage() {
  const [message, setMessage] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/feedback");
    if (res.ok) setItems(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addScreenshots(files: FileList | null) {
    if (!files) return;
    setAdding(true);
    try {
      const next = [...screenshots];
      for (const f of Array.from(files).slice(0, 3 - next.length)) {
        next.push(await compressPhoto(f));
      }
      setScreenshots(next);
    } finally {
      setAdding(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this idea?")) return;
    await fetch(`/api/feedback?id=${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function submit() {
    if (!message.trim() || sending) return;
    setSending(true);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, screenshots }),
    });
    setSending(false);
    if (res.ok) {
      setMessage("");
      setScreenshots([]);
      setSent(true);
      setTimeout(() => setSent(false), 4000);
      await load();
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-amber-500" />
          Submit ideas
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Suggest improvements to the experience, navigation or features — screenshots welcome.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-1">Your idea</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="e.g. It would be great if the calendar showed cleaning tasks too..."
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />

        {screenshots.length > 0 && (
          <div className="flex gap-2 mt-3">
            {screenshots.map((s, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s} alt={`screenshot ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                <button
                  onClick={() => setScreenshots((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 text-white rounded-full flex items-center justify-center hover:bg-slate-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <label
            className={`flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
              screenshots.length >= 3 ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <Camera className="w-4 h-4" />
            {adding ? "Adding..." : `Add screenshot${screenshots.length > 0 ? ` (${screenshots.length}/3)` : ""}`}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addScreenshots(e.target.files)}
              disabled={adding || screenshots.length >= 3}
            />
          </label>
          <button
            onClick={submit}
            disabled={sending || !message.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit idea
          </button>
        </div>

        {sent && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <Check className="w-4 h-4" />
            Thank you! Your idea was submitted.
          </p>
        )}
      </div>

      {/* Previously submitted */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">Your submitted ideas</h3>
        </div>
        {items.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Nothing submitted yet — your first idea goes here.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((item) => {
              const shots: string[] = item.screenshots ? JSON.parse(item.screenshots) : [];
              return (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{item.message}</p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[item.status] || "bg-slate-100 text-slate-600"}`}>
                        {item.status}
                      </span>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {shots.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {shots.map((s, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={s} alt="" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-2">
                    {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
