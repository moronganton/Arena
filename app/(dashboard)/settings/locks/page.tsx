"use client";
import { useState, useEffect } from "react";
import { Plus, Key, Trash2, Battery, RefreshCw, Send } from "lucide-react";

interface Property {
  id: string;
  name: string;
}

interface SmartLock {
  id: string;
  ttlockId: string;
  name: string;
  batteryLevel?: number;
  lockType: string;
  isActive: boolean;
  property: { id: string; name: string };
  _count: { accessCodes: number };
}

interface Reservation {
  id: string;
  confirmationCode?: string;
  checkIn: string;
  checkOut: string;
  guest: { name: string };
  property: { name: string };
}

export default function LocksPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [locks, setLocks] = useState<SmartLock[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [selectedLock, setSelectedLock] = useState<string>("");
  const [selectedReservation, setSelectedReservation] = useState<string>("");
  const [form, setForm] = useState({
    propertyId: "",
    ttlockId: "",
    name: "",
    lockType: "PIN",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/properties").then((r) => r.json()),
      fetch("/api/ttlock/locks").then((r) => r.json()),
      fetch("/api/reservations?status=CONFIRMED").then((r) => r.json()),
    ]).then(([props, lockData, resData]) => {
      setProperties(props);
      setLocks(lockData);
      setReservations(resData);
      if (props.length > 0) setForm((f) => ({ ...f, propertyId: props[0].id }));
    });
  }, []);

  async function saveLock() {
    const res = await fetch("/api/ttlock/locks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const lock = await res.json();
      setLocks((prev) => [...prev, lock]);
      setShowForm(false);
    }
  }

  async function generateCode() {
    if (!selectedLock || !selectedReservation) return;
    setGenerating(selectedReservation);
    const res = await fetch("/api/ttlock/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockId: selectedLock, reservationId: selectedReservation }),
    });
    if (res.ok) {
      const { code } = await res.json();
      alert(`Access code generated: ${code}\nSent to guest via email (if email is on file).`);
    }
    setGenerating(null);
  }

  async function deleteLock(id: string) {
    await fetch(`/api/ttlock/locks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive: false }),
    });
    setLocks((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Smart Locks (TTLock)</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage access codes for your properties</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" />
          Add Lock
        </button>
      </div>

      {/* TTLock Setup Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 text-sm text-blue-800">
        <strong>TTLock Setup:</strong> Register at{" "}
        <a href="https://open.ttlock.com" target="_blank" rel="noopener" className="underline">
          open.ttlock.com
        </a>{" "}
        to get your Client ID and Secret. Then add your lock's Device ID (found in the TTLock app).
        Access codes will be automatically generated when a new reservation is received and sent to guests by email.
      </div>

      {/* Generate Code */}
      {locks.length > 0 && reservations.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Generate Access Code</h3>
          <div className="flex gap-3 flex-wrap">
            <select
              value={selectedLock}
              onChange={(e) => setSelectedLock(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select Lock</option>
              {locks.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.property.name})</option>
              ))}
            </select>
            <select
              value={selectedReservation}
              onChange={(e) => setSelectedReservation(e.target.value)}
              className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select Reservation</option>
              {reservations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.guest.name} — {r.property.name} ({new Date(r.checkIn).toLocaleDateString()} – {new Date(r.checkOut).toLocaleDateString()})
                </option>
              ))}
            </select>
            <button
              onClick={generateCode}
              disabled={!selectedLock || !selectedReservation || !!generating}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              Generate & Send
            </button>
          </div>
        </div>
      )}

      {/* Add Lock Form */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Add Smart Lock</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
              <select
                value={form.propertyId}
                onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Lock Type</label>
              <select
                value={form.lockType}
                onChange={(e) => setForm({ ...form, lockType: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="PIN">PIN Code</option>
                <option value="CARD">Card</option>
                <option value="FINGERPRINT">Fingerprint</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Lock Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Front Door"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">TTLock Device ID</label>
              <input
                value={form.ttlockId}
                onChange={(e) => setForm({ ...form, ttlockId: e.target.value })}
                placeholder="Found in TTLock app"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={saveLock}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              Add Lock
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Locks List */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {locks.length === 0 ? (
          <div className="text-center py-16">
            <Key className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No smart locks configured</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {locks.map((lock) => (
              <div key={lock.id} className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center">
                    <Key className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{lock.name}</p>
                    <p className="text-xs text-slate-500">{lock.property.name} · {lock.lockType} · ID: {lock.ttlockId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {lock.batteryLevel !== null && lock.batteryLevel !== undefined && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Battery className={`w-4 h-4 ${lock.batteryLevel < 20 ? "text-red-500" : "text-green-500"}`} />
                      <span className="text-slate-600">{lock.batteryLevel}%</span>
                    </div>
                  )}
                  <span className="text-xs text-slate-500">{lock._count.accessCodes} codes</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lock.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {lock.isActive ? "Active" : "Inactive"}
                  </span>
                  <button
                    onClick={() => deleteLock(lock.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
