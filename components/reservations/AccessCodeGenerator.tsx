"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Plus, RefreshCw, Copy, Check, AlertTriangle } from "lucide-react";

interface Lock {
  id: string;
  name: string;
  isActive: boolean;
}

interface AccessCodeGeneratorProps {
  reservationId: string;
  guestName: string;
  propertyName: string;
  locks: Lock[];
  externalId?: string | null;
}

interface GeneratedCode {
  code: string;
  lockName: string;
  validFrom: string;
  validTo: string;
  lockError?: string | null;
}

export function AccessCodeGenerator({
  reservationId,
  guestName,
  propertyName,
  locks,
  externalId,
}: AccessCodeGeneratorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLockId, setSelectedLockId] = useState(locks[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSmoobu, setSendSmoobu] = useState(!!externalId);
  const [sendMessage, setSendMessage] = useState(true);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeLocks = locks.filter((l) => l.isActive);

  async function handleGenerateCode() {
    if (!selectedLockId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/reservations/access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockId: selectedLockId,
          reservationId,
        }),
      });
      if (!res.ok) {
        alert("Failed to generate code");
        return;
      }
      const data = await res.json();
      const lock = locks.find((l) => l.id === selectedLockId);
      setGenerated({
        code: data.code,
        lockName: lock?.name || "Unknown Lock",
        validFrom: data.validFrom,
        validTo: data.validTo,
        lockError: data.lockError,
      });
      // The access-code list is rendered by the server component behind this
      // modal, so a new code stayed invisible until the whole app was reloaded.
      // refresh() re-runs that server render while leaving client state alone,
      // so the modal keeps showing the code it just generated.
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Error generating code");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMessage() {
    if (!generated) return;
    setSending(true);
    try {
      const res = await fetch("/api/reservations/access-code-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId,
          code: generated.code,
          guestName,
          propertyName,
          validFrom: generated.validFrom,
          validTo: generated.validTo,
          sendEmail,
          sendSmoobu: sendSmoobu && externalId,
          sendMessage,
        }),
      });
      if (!res.ok) {
        alert("Failed to send message");
        return;
      }
      alert("Code and message sent successfully!");
      setIsOpen(false);
      setGenerated(null);
      router.refresh(); // sending also posts to the message thread
    } catch (err) {
      console.error(err);
      alert("Error sending message");
    } finally {
      setSending(false);
    }
  }

  function copyToClipboard() {
    if (generated) {
      navigator.clipboard.writeText(generated.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        disabled={activeLocks.length === 0}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:bg-slate-50 disabled:opacity-50 text-indigo-700 disabled:text-slate-500 rounded-lg font-medium transition"
      >
        <Plus className="w-3.5 h-3.5" />
        Generate Extra
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-600" />
              Generate Extra PIN Code
            </h3>

            {!generated ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Select Lock
                  </label>
                  <select
                    value={selectedLockId}
                    onChange={(e) => setSelectedLockId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {activeLocks.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleGenerateCode}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Generate Code
                    </>
                  )}
                </button>

                <button
                  onClick={() => setIsOpen(false)}
                  className="w-full bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-xs text-green-600 font-medium mb-2">Code Generated</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono font-bold text-2xl text-slate-900 tracking-widest">
                      {generated.code}
                    </p>
                    <button
                      onClick={copyToClipboard}
                      className="p-2 hover:bg-green-100 rounded-lg transition"
                      title="Copy code"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4 text-green-600" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-green-700 mt-2">
                    Lock: <span className="font-medium">{generated.lockName}</span>
                  </p>
                  <p className="text-xs text-green-700">
                    Valid: {generated.validFrom} → {generated.validTo}
                  </p>
                </div>

                {generated.lockError && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-rose-800">Not pushed to the lock</p>
                      <p className="text-xs text-rose-700 mt-0.5">
                        This code is saved in StayHQ but the door will not open on it yet: {generated.lockError}
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-700">Send PIN to Guest?</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendEmail}
                      onChange={(e) => setSendEmail(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700">Send via Email</span>
                  </label>
                  {externalId && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendSmoobu}
                        onChange={(e) => setSendSmoobu(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700">Send via OTA (Booking.com/Airbnb)</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendMessage}
                      onChange={(e) => setSendMessage(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700">Post to Message Thread</span>
                  </label>
                </div>

                <button
                  onClick={handleSendMessage}
                  disabled={sending || (!sendEmail && !sendSmoobu && !sendMessage)}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                >
                  {sending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send to Guest"
                  )}
                </button>

                <button
                  onClick={() => {
                    setGenerated(null);
                    setSelectedLockId(activeLocks[0]?.id || "");
                  }}
                  className="w-full bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
                >
                  Generate Another
                </button>

                <button
                  onClick={() => setIsOpen(false)}
                  className="w-full bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
