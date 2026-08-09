"use client";
import { useState, useEffect } from "react";
import { ShieldCheck, RefreshCw, Check, AlertTriangle, Mail } from "lucide-react";

export default function AccountSecurityPage() {
  // --- password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState(false);

  // --- email ---
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailDone, setEmailDone] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/email")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCurrentEmail(d.currentEmail ?? null);
        if (d.pending?.newEmail) setPendingEmail(d.pending.newEmail);
      })
      .catch(() => {});
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (newPassword !== confirmPassword) {
      setPwError("The two new passwords do not match.");
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || "Could not change the password."); return; }
      setPwDone(true);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch {
      setPwError("Network error — the password was not changed.");
    } finally {
      setSavingPw(false);
    }
  }

  async function requestEmailCode(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setSavingEmail(true);
    try {
      const res = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, currentPassword: emailPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setEmailError(data.error || "Could not start the change."); return; }
      setPendingEmail(data.newEmail);
      setEmailPassword("");
    } catch {
      setEmailError("Network error — nothing was changed.");
    } finally {
      setSavingEmail(false);
    }
  }

  async function confirmEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setSavingEmail(true);
    try {
      const res = await fetch("/api/account/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) { setEmailError(data.error || "Could not confirm the code."); return; }
      setEmailDone(data.newEmail);
      setPendingEmail(null);
      setCurrentEmail(data.newEmail);
      setCode(""); setNewEmail("");
    } catch {
      setEmailError("Network error — nothing was changed.");
    } finally {
      setSavingEmail(false);
    }
  }

  const inputCls =
    "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-500" />
          Account security
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Change how you sign in{currentEmail ? ` — currently ${currentEmail}` : ""}.
        </p>
      </div>

      {/* Password */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Password</h2>
        {pwDone ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Password changed</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                It is stored hashed. Use the new password next time you sign in.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password" required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password" required className={inputCls} />
              <p className="text-xs text-slate-400 mt-1">
                At least 10 characters. Length matters more than symbols — a short phrase you can
                remember beats a mangled word.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password" required className={inputCls} />
            </div>
            {pwError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{pwError}</p>
              </div>
            )}
            <button type="submit" disabled={savingPw || !currentPassword || !newPassword || !confirmPassword}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
              {savingPw ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {savingPw ? "Changing…" : "Change password"}
            </button>
          </form>
        )}
      </div>

      {/* Sign-in email */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Sign-in email</h2>
        <p className="text-xs text-slate-500 mb-3">
          A code is sent to the new address first. Your sign-in email only changes once you enter
          it — so a typo can never lock you out.
        </p>

        {emailDone ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Sign-in email is now {emailDone}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Use it next time you sign in. Your current session stays active.
              </p>
            </div>
          </div>
        ) : pendingEmail ? (
          <form onSubmit={confirmEmail} className="space-y-4">
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 flex items-start gap-2">
              <Mail className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-900">
                Code sent to <span className="font-semibold">{pendingEmail}</span>. It expires in 15
                minutes. Nothing has changed yet.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">6-digit code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                maxLength={6} required placeholder="123456"
                className={`${inputCls} font-mono tracking-widest`} />
            </div>
            {emailError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{emailError}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={savingEmail || code.length < 6}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
                {savingEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm new email
              </button>
              <button type="button" onClick={() => { setPendingEmail(null); setCode(""); setEmailError(""); }}
                className="px-4 py-2.5 rounded-xl text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition">
                Start over
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={requestEmailCode} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New email</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com" required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
              <input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)}
                autoComplete="current-password" required className={inputCls} />
            </div>
            {emailError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{emailError}</p>
              </div>
            )}
            <button type="submit" disabled={savingEmail || !newEmail || !emailPassword}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition">
              {savingEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {savingEmail ? "Sending code…" : "Send confirmation code"}
            </button>
          </form>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-4">
        After 5 failed sign-in attempts, that email is locked out for 15 minutes.
      </p>
    </div>
  );
}
