"use client";
import { useState, useEffect } from "react";
import { Save, TestTube, RefreshCw, CheckCircle2, AlertTriangle, HelpCircle, Gauge, Building2 } from "lucide-react";

interface AiSettings {
  id?: string;
  enabled: boolean;
  autoReplyEnabled: boolean;
  confidenceThreshold: number;
  language: string;
  customInstructions?: string;
}

interface Property {
  id: string;
  name: string;
  city: string;
  aiEnabled: boolean;
}

interface AiHealth {
  status: "ok" | "error" | "unknown";
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
  reqRemaining: number | null;
  tokensRemaining: number | null;
  tokensLimit: number | null;
  resetAt: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const ERROR_HELP: Record<string, string> = {
  rate_limit:
    "Too many requests/tokens per minute for your usage tier. It usually clears within a minute — to raise the ceiling, increase your tier in the Anthropic console → Limits.",
  billing:
    "Your prepaid balance is exhausted or the spend cap was reached. Top up in the Anthropic console → Billing, and turn on auto-reload so it never runs out mid-conversation.",
  auth: "The ANTHROPIC_API_KEY is missing, wrong, or revoked. Set a valid key in Railway → Variables.",
  overloaded: "Anthropic's API was briefly overloaded. This clears on its own and the assistant retries automatically.",
  other: "The AI request failed unexpectedly. Check the server logs for details.",
};

const SAMPLE_QUESTIONS = [
  "What is the WiFi password?",
  "What time is check-in?",
  "Can I check out late?",
  "Is parking available?",
  "Where do I pick up the keys?",
];

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings>({
    enabled: true,
    autoReplyEnabled: true,
    confidenceThreshold: 0.8,
    language: "en",
    customInstructions: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<{ message: string; confidence: number; shouldReply: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [refreshingHealth, setRefreshingHealth] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [togglingPropertyId, setTogglingPropertyId] = useState<string | null>(null);

  async function loadHealth() {
    setRefreshingHealth(true);
    try {
      const r = await fetch("/api/ai/health");
      if (r.ok) setHealth(await r.json());
    } finally {
      setRefreshingHealth(false);
    }
  }

  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((data) => {
        if (data) setSettings(data);
      });
    loadHealth();
    fetch("/api/properties")
      .then((r) => r.json())
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .finally(() => setPropertiesLoading(false));
  }, []);

  async function togglePropertyAi(property: Property) {
    setTogglingPropertyId(property.id);
    const next = !property.aiEnabled;
    setProperties((prev) => prev.map((p) => (p.id === property.id ? { ...p, aiEnabled: next } : p)));
    await fetch(`/api/properties/${property.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiEnabled: next }),
    });
    setTogglingPropertyId(null);
  }

  async function saveSettings() {
    setSaving(true);
    await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_settings", ...settings }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testReply() {
    if (!testMessage) return;
    setTesting(true);
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "test_reply",
        message: testMessage,
        customInstructions: settings.customInstructions,
        guestName: "Test Guest",
        propertyName: "Example Villa",
        propertyAddress: "123 Sunset Blvd, Barcelona, Spain",
        checkIn: new Date().toISOString(),
        checkOut: new Date(Date.now() + 3 * 86400000).toISOString(),
      }),
    });
    if (res.ok) {
      const result = await res.json();
      setTestResult(result);
    }
    setTesting(false);
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Assistant</h1>
          <p className="text-slate-500 text-sm mt-0.5">Powered by Claude — automatic guest message replies</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
          <span className="text-sm text-indigo-600 font-medium">Claude AI</span>
        </div>
      </div>

      {/* AI Status — live health of the Anthropic API behind the assistant */}
      <AiStatusCard health={health} onRefresh={loadHealth} refreshing={refreshingHealth} />

      {/* Settings */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-5">Configuration</h2>
        <div className="space-y-5">
          <div className="flex items-center justify-between py-3 border-b border-slate-50">
            <div>
              <p className="font-medium text-slate-900">AI Assistant</p>
              <p className="text-sm text-slate-500">Enable the AI assistant for this account</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.enabled ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-slate-50">
            <div>
              <p className="font-medium text-slate-900">Auto-Reply</p>
              <p className="text-sm text-slate-500">Automatically send AI-generated replies to guests</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, autoReplyEnabled: !settings.autoReplyEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autoReplyEnabled && settings.enabled ? "bg-indigo-600" : "bg-slate-300"
              }`}
              disabled={!settings.enabled}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.autoReplyEnabled && settings.enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="py-3 border-b border-slate-50">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-medium text-slate-900">Confidence Threshold</p>
                <p className="text-sm text-slate-500">Only auto-reply when AI is at least this confident</p>
              </div>
              <span className="text-indigo-600 font-bold">{Math.round(settings.confidenceThreshold * 100)}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="100"
              value={Math.round(settings.confidenceThreshold * 100)}
              onChange={(e) => setSettings({ ...settings, confidenceThreshold: parseInt(e.target.value) / 100 })}
              className="w-full accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>50% (More replies)</span>
              <span>100% (Very conservative)</span>
            </div>
          </div>

          <div className="py-3 border-b border-slate-50">
            <label className="block font-medium text-slate-900 mb-1">Response Language</label>
            <p className="text-sm text-slate-500 mb-3">AI will respond in this language (or match guest&apos;s language)</p>
            <select
              value={settings.language}
              onChange={(e) => setSettings({ ...settings, language: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="auto">Auto-detect (match guest)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-900 mb-1">Custom Instructions</label>
            <p className="text-sm text-slate-500 mb-3">Tell the AI specific facts about your properties (WiFi passwords, parking, house rules, etc.)</p>
            <textarea
              value={settings.customInstructions || ""}
              onChange={(e) => setSettings({ ...settings, customInstructions: e.target.value })}
              rows={5}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder={`Example:\n- WiFi network: VilaGuest | Password: Summer2024!\n- Check-in: 3pm, Check-out: 11am\n- Parking: free in the private garage on the left\n- Pool is open 8am–10pm\n- No parties or smoking indoors`}
            />
          </div>
        </div>

        <button
          onClick={saveSettings}
          disabled={saving}
          className="mt-5 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>

      {/* Per-property on/off */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-1">Properties</h2>
        <p className="text-sm text-slate-500 mb-5">
          Turn the assistant off for a specific property without affecting the rest — useful if you want to
          handle one property&apos;s guests yourself while the AI covers the others.
        </p>
        {propertiesLoading ? (
          <p className="text-sm text-slate-400">Loading properties…</p>
        ) : properties.length === 0 ? (
          <p className="text-sm text-slate-400">No properties yet.</p>
        ) : (
          <div className="space-y-1">
            {properties.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.city}</p>
                  </div>
                </div>
                <button
                  onClick={() => togglePropertyAi(p)}
                  disabled={togglingPropertyId === p.id || !settings.enabled}
                  title={!settings.enabled ? "Turn on the AI Assistant above first" : undefined}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
                    p.aiEnabled && settings.enabled ? "bg-indigo-600" : "bg-slate-300"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.aiEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test AI */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h2 className="font-semibold text-slate-900 mb-2">Test AI Reply</h2>
        <p className="text-sm text-slate-500 mb-4">See how the AI would respond to a guest message</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => setTestMessage(q)}
              className="text-xs border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <input
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Type a guest message to test..."
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={testReply}
            disabled={!testMessage || testing}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
            Test
          </button>
        </div>

        {testResult && (
          <div className={`mt-4 p-4 rounded-xl border ${testResult.shouldReply ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-semibold ${testResult.shouldReply ? "text-green-700" : "text-orange-700"}`}>
                {testResult.shouldReply ? "Would auto-reply" : "Would NOT auto-reply (needs human review)"}
              </span>
              <span className="text-xs text-slate-500">
                Confidence: <strong>{Math.round(testResult.confidence * 100)}%</strong>
              </span>
            </div>
            {testResult.message && (
              <div className="bg-white rounded-lg p-3 text-sm text-slate-800 border border-slate-100">
                {testResult.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AiStatusCard({
  health,
  onRefresh,
  refreshing,
}: {
  health: AiHealth | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const status = health?.status ?? "unknown";
  const isError = status === "error";
  const isOk = status === "ok";

  const tone = isError
    ? { bg: "bg-rose-50", border: "border-rose-200", dot: "bg-rose-500", text: "text-rose-700", label: "Paused" }
    : isOk
    ? { bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500", text: "text-emerald-700", label: "Working" }
    : { bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400", text: "text-slate-600", label: "No activity yet" };

  const Icon = isError ? AlertTriangle : isOk ? CheckCircle2 : HelpCircle;

  // Rate-limit headroom as a percentage of this minute's token budget
  const pct =
    health?.tokensRemaining != null && health?.tokensLimit
      ? Math.max(0, Math.min(100, Math.round((health.tokensRemaining / health.tokensLimit) * 100)))
      : null;
  const barColor = pct == null ? "bg-slate-300" : pct < 15 ? "bg-rose-500" : pct < 40 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} p-6 mb-6`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-5 h-5 ${tone.text}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${tone.dot} ${isOk ? "animate-pulse" : ""}`} />
              <h2 className={`font-semibold ${tone.text}`}>AI Status — {tone.label}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Live health of the Claude API that powers guest replies</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg hover:border-indigo-300 hover:text-indigo-600 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* When it's blocked, spell out exactly what's wrong and what to do */}
      {isError && health?.lastErrorType && (
        <div className="bg-white rounded-xl border border-rose-200 p-4 mb-4">
          <p className="font-medium text-rose-700 text-sm">{health.lastErrorMessage || "AI reply failed"}</p>
          <p className="text-sm text-slate-600 mt-1">{ERROR_HELP[health.lastErrorType] ?? ERROR_HELP.other}</p>
          {(health.lastErrorType === "billing" || health.lastErrorType === "rate_limit") && (
            <a
              href={health.lastErrorType === "billing" ? "https://console.anthropic.com/settings/billing" : "https://console.anthropic.com/settings/limits"}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition"
            >
              Open Anthropic console →
            </a>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-white rounded-xl border border-slate-100 p-3">
          <p className="text-xs text-slate-500">Last successful reply</p>
          <p className="font-semibold text-slate-800 mt-0.5">{timeAgo(health?.lastSuccessAt ?? null)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-3">
          <p className="text-xs text-slate-500">Last problem</p>
          <p className="font-semibold text-slate-800 mt-0.5">{health?.lastErrorAt ? timeAgo(health.lastErrorAt) : "none"}</p>
        </div>
      </div>

      {/* Rate-limit headroom — how close we are to the per-minute API ceiling */}
      <div className="bg-white rounded-xl border border-slate-100 p-3 mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gauge className="w-3.5 h-3.5" /> Rate-limit headroom (this minute)
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {pct != null ? `${pct}%` : health?.tokensRemaining != null ? `${health.tokensRemaining.toLocaleString()} tokens` : "—"}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct ?? 0}%` }} />
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          Refills every minute. Low headroom just means high traffic right now — the assistant auto-retries when it clears.
        </p>
      </div>

      <p className="text-xs text-slate-500 mt-4 leading-relaxed">
        You&apos;ll get an <strong>email the moment the AI is blocked</strong> by a rate limit, empty credits, or a bad key —
        so you can top up before guests notice. Anthropic doesn&apos;t expose a live &quot;remaining balance&quot; number, so the
        surest prevention is turning on <strong>auto-reload</strong> in the{" "}
        <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
          Anthropic console → Billing
        </a>
        . Note: this is your Anthropic <strong>API</strong> account (per-token), separate from any Claude Pro subscription.
      </p>
    </div>
  );
}
