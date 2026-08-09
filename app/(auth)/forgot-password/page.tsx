"use client";
import { useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Mail, Check, AlertTriangle, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"request" | "verify" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not send a code."); return; }
      setNotice(data.message || "If that address has an account, a code is on its way.");
      setStep("verify");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not reset the password."); return; }
      setStep("done");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">StayHQ</h1>
          <p className="text-slate-400 mt-1">Property Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {step === "done" ? (
            <>
              <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4 mb-5">
                <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-800">Password reset</p>
                  <p className="text-xs text-emerald-700 mt-0.5">Sign in with your new password.</p>
                </div>
              </div>
              <Link
                href="/login"
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-lg transition"
              >
                Go to sign in
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-800 mb-1">Reset your password</h2>
              <p className="text-sm text-slate-500 mb-6">
                {step === "request"
                  ? "We'll email you a 6-digit code."
                  : "Enter the code from your email and choose a new password."}
              </p>

              {step === "request" ? (
                <form onSubmit={requestCode} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className={inputCls}
                    />
                  </div>
                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Send code
                  </button>
                </form>
              ) : (
                <form onSubmit={submitNewPassword} className="space-y-4">
                  {notice && (
                    <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 flex items-start gap-2">
                      <Mail className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-indigo-900">{notice}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">6-digit code</label>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      required
                      className={`${inputCls} font-mono tracking-widest`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      className={inputCls}
                    />
                    <p className="text-xs text-slate-400 mt-1">At least 10 characters.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      className={inputCls}
                    />
                  </div>
                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading || code.length < 6 || !newPassword || !confirmPassword}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Set new password
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("request"); setCode(""); setError(""); }}
                    className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
                  >
                    Use a different email
                  </button>
                </form>
              )}

              <div className="mt-6 pt-6 border-t border-slate-100 text-center">
                <Link href="/login" className="text-sm text-slate-500 hover:text-indigo-600 inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
