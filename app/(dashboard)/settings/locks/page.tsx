"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Key, Trash2, Battery, RefreshCw, Link2, Unlink, Download, Check, Pencil } from "lucide-react";

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

interface CloudLock {
  ttlockId: string;
  name: string;
  batteryLevel: number | null;
  imported: boolean;
  propertyId?: string;
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

  // TTLock account state
  const [ttlock, setTtlock] = useState<{ connected: boolean; username: string | null }>({ connected: false, username: null });
  const [creds, setCreds] = useState({ username: "", password: "" });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Import state
  const [cloudLocks, setCloudLocks] = useState<CloudLock[] | null>(null);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  const loadData = useCallback(async () => {
    const [props, lockData, resData, acct] = await Promise.all([
      fetch("/api/properties").then((r) => r.json()),
      fetch("/api/ttlock/locks").then((r) => r.json()),
      fetch("/api/reservations?status=CONFIRMED").then((r) => r.json()),
      fetch("/api/ttlock/account").then((r) => r.json()),
    ]);
    setProperties(Array.isArray(props) ? props : []);
    setLocks(Array.isArray(lockData) ? lockData : []);
    setReservations(Array.isArray(resData) ? resData : []);
    setTtlock({ connected: !!acct.connected, username: acct.username });
    if (props.length > 0) setForm((f) => ({ ...f, propertyId: f.propertyId || props[0].id }));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function connectAccount() {
    setConnecting(true);
    setConnectError("");
    const res = await fetch("/api/ttlock/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    });
    const data = await res.json();
    if (res.ok) {
      setTtlock({ connected: true, username: data.username });
      setCreds({ username: "", password: "" });
    } else {
      setConnectError(data.error || "Connection failed");
    }
    setConnecting(false);
  }

  async function disconnectAccount() {
    if (!confirm("Disconnect your TTLock account? Codes will no longer be pushed to your physical locks.")) return;
    await fetch("/api/ttlock/account", { method: "DELETE" });
    setTtlock({ connected: false, username: null });
    setCloudLocks(null);
  }

  async function fetchCloudLocks() {
    setLoadingCloud(true);
    setImportMessage("");
    const res = await fetch("/api/ttlock/import");
    const data = await res.json();
    if (res.ok) {
      const defaultProp = properties[0]?.id;
      setCloudLocks(data.map((l: CloudLock) => ({ ...l, propertyId: defaultProp })));
    } else {
      setImportMessage(data.error || "Failed to fetch locks");
    }
    setLoadingCloud(false);
  }

  async function importLocks() {
    if (!cloudLocks) return;
    setImporting(true);
    const toImport = cloudLocks.filter((l) => !l.imported);
    const res = await fetch("/api/ttlock/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locks: toImport }),
    });
    const data = await res.json();
    if (res.ok) {
      setImportMessage(`Imported ${data.imported} lock${data.imported === 1 ? "" : "s"}.`);
      setCloudLocks(null);
      await loadData();
    } else {
      setImportMessage(data.error || "Import failed");
    }
    setImporting(false);
  }

  async function saveLock() {
    const res = await fetch("/api/ttlock/locks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      await loadData();
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
      alert(`Access code generated: ${code}\nPushed to the lock (if TTLock is connected) and emailed to the guest.`);
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

  // Edit lock state
  const [editingLock, setEditingLock] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", propertyId: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  function startEdit(lock: SmartLock) {
    setEditingLock(lock.id);
    setEditForm({ name: lock.name, propertyId: lock.property.id });
  }

  async function saveEdit() {
    if (!editingLock) return;
    setSavingEdit(true);
    const res = await fetch("/api/ttlock/locks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingLock, name: editForm.name, propertyId: editForm.propertyId }),
    });
    setSavingEdit(false);
    if (res.ok) {
      setEditingLock(null);
      await loadData();
    } else {
      alert("Failed to update lock.");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
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
          Add Manually
        </button>
      </div>

      {/* TTLock Account Connection */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1">
          <Link2 className="w-4 h-4 text-slate-500" />
          TTLock Account
        </h3>

        {ttlock.connected ? (
          <div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-slate-700">
                  Connected as <strong>{ttlock.username}</strong>
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={fetchCloudLocks}
                  disabled={loadingCloud}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium transition disabled:opacity-50"
                >
                  <Download className={`w-3.5 h-3.5 ${loadingCloud ? "animate-bounce" : ""}`} />
                  {loadingCloud ? "Loading..." : "Import my locks"}
                </button>
                <button
                  onClick={disconnectAccount}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Cloud locks import list */}
            {cloudLocks && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                {cloudLocks.length === 0 ? (
                  <p className="text-sm text-slate-400">No locks found in your TTLock account. Add them in the TTLock mobile app first.</p>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Locks in your TTLock account</p>
                    <div className="space-y-2">
                      {cloudLocks.map((cl, i) => (
                        <div key={cl.ttlockId} className="flex items-center gap-3 text-sm">
                          <Key className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800 flex-1">{cl.name}</span>
                          {cl.batteryLevel !== null && (
                            <span className="text-xs text-slate-500">{cl.batteryLevel}% 🔋</span>
                          )}
                          {cl.imported ? (
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <Check className="w-3.5 h-3.5" /> Imported
                            </span>
                          ) : (
                            <select
                              value={cl.propertyId}
                              onChange={(e) => {
                                const next = [...cloudLocks];
                                next[i] = { ...cl, propertyId: e.target.value };
                                setCloudLocks(next);
                              }}
                              className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              {properties.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                    {cloudLocks.some((l) => !l.imported) && (
                      <button
                        onClick={importLocks}
                        disabled={importing}
                        className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
                      >
                        {importing ? "Importing..." : "Import selected locks"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {importMessage && (
              <div className="mt-3 px-3 py-2 rounded-lg text-xs font-medium bg-green-50 text-green-700">{importMessage}</div>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-slate-500 mb-4">
              Connect the account you use in the TTLock mobile app. StayHQ will then push PIN codes
              to your physical locks automatically for every reservation.
            </p>
            {connectError && (
              <div className="mb-3 px-3 py-2 rounded-lg text-xs font-medium bg-red-50 text-red-700">{connectError}</div>
            )}
            <div className="flex gap-3 flex-wrap">
              <input
                value={creds.username}
                onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                placeholder="TTLock username (email or phone)"
                className="flex-1 min-w-52 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="password"
                value={creds.password}
                onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                placeholder="TTLock password"
                className="flex-1 min-w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={connectAccount}
                disabled={connecting || !creds.username || !creds.password}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Generate Code */}
      {locks.length > 0 && reservations.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-1">Generate Access Code Manually</h3>
          <p className="text-xs text-slate-500 mb-4">
            New reservations get codes automatically. Use this for existing reservations.
          </p>
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

      {/* Add Lock Form (manual) */}
      {showForm && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-slate-900 mb-4">Add Smart Lock Manually</h3>
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
            <p className="text-slate-400 text-xs mt-1">Connect your TTLock account above and import your locks</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {locks.map((lock) => (
              <div key={lock.id} className="p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
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
                      onClick={() => (editingLock === lock.id ? setEditingLock(null) : startEdit(lock))}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      title="Edit lock"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteLock(lock.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Inline edit form */}
                {editingLock === lock.id && (
                  <div className="mt-4 ml-15 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Lock Name</label>
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Property</label>
                        <select
                          value={editForm.propertyId}
                          onChange={(e) => setEditForm({ ...editForm, propertyId: e.target.value })}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {properties.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
                      >
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingLock(null)}
                        className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-200 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
