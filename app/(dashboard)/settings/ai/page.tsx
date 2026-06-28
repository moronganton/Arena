"use client";
import { useState, useEffect } from "react";
import { Bot, Save, TestTube, RefreshCw } from "lucide-react";

interface AiSettings {
  id?: string;
  enabled: boolean;
  autoReplyEnabled: boolean;
  confidenceThreshold: number;
  language: string;
  customInstructions?: string;
}

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

  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((data) => {
        if (data) setSettings(data);
      });
  }, []);

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
            <p className="text-sm text-slate-500 mb-3">AI will respond in this language (or match guest's language)</p>
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
