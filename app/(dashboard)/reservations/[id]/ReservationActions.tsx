"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, XCircle, RefreshCw } from "lucide-react";

interface Props {
  id: string;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  totalAmount: number | null;
}

const OTA_SOURCES = ["AIRBNB", "BOOKING", "VRBO", "EXPEDIA"];

export default function ReservationActions(props: Props) {
  const router = useRouter();
  const isOta = OTA_SOURCES.includes(props.source);
  const [showEdit, setShowEdit] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    checkIn: props.checkIn.slice(0, 10),
    checkOut: props.checkOut.slice(0, 10),
    adults: String(props.adults),
    children: String(props.children),
    totalAmount: props.totalAmount != null ? String(props.totalAmount) : "",
    status: props.status,
  });

  async function saveChanges() {
    setBusy(true);
    const res = await fetch(`/api/reservations/${props.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkIn: form.checkIn,
        checkOut: form.checkOut,
        adults: parseInt(form.adults),
        children: parseInt(form.children),
        totalAmount: form.totalAmount ? parseFloat(form.totalAmount) : undefined,
        status: form.status,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setShowEdit(false);
      router.refresh();
    } else {
      alert("Failed to save changes.");
    }
  }

  async function cancelReservation() {
    setBusy(true);
    const res = await fetch(`/api/reservations/${props.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setShowCancel(false);
      router.refresh();
    } else {
      alert("Failed to cancel reservation.");
    }
  }

  if (props.status === "CANCELLED") {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium transition"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Modify
        </button>
        <button
          onClick={() => setShowCancel(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition"
        >
          <XCircle className="w-3.5 h-3.5" />
          Cancel Reservation
        </button>
      </div>

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Modify Reservation</h3>
            {isOta && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2 mb-2">
                This reservation came from {props.source}. Changes here only apply in StayHQ —
                they will not sync back to the platform.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Check-in</label>
                <input
                  type="date"
                  value={form.checkIn}
                  onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Check-out</label>
                <input
                  type="date"
                  value={form.checkOut}
                  onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Adults</label>
                <input
                  type="number" min="1"
                  value={form.adults}
                  onChange={(e) => setForm({ ...form, adults: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Children</label>
                <input
                  type="number" min="0"
                  value={form.children}
                  onChange={(e) => setForm({ ...form, children: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Total Amount</label>
                <input
                  type="number" min="0" step="0.01"
                  value={form.totalAmount}
                  onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="PENDING">Pending</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="CHECKED_IN">Checked In</option>
                  <option value="CHECKED_OUT">Checked Out</option>
                  <option value="NO_SHOW">No Show</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Note: changing dates does not update already-issued lock codes. Cancel and regenerate
              the code if the dates change.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={saveChanges}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition"
              >
                {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
                Save Changes
              </button>
              <button
                onClick={() => setShowEdit(false)}
                className="flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Cancel Reservation?</h3>
            <p className="text-slate-500 text-sm mb-2">
              The reservation will be marked as cancelled and any active lock codes will be
              removed from the smart lock.
            </p>
            {isOta && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-2">
                This only cancels in StayHQ — cancel on {props.source} separately if needed.
              </p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={cancelReservation}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition"
              >
                {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
                Yes, Cancel It
              </button>
              <button
                onClick={() => setShowCancel(false)}
                className="flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition"
              >
                Keep It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
