import React, { useState } from "react";
import type { JarvisSettings } from "../../settings/types";
import { validateSettings } from "../../settings/types";
import { aiProviderRegistry } from "../../ai/AIProvider";

interface Props {
  settings: JarvisSettings;
  onChange: (settings: JarvisSettings) => void;
  onSave: () => Promise<void>;
  onSaveProviderKey: (providerName: string, key: string) => Promise<void>;
  onRemoveProviderKey: (providerName: string) => Promise<void>;
  onTestProviderKey: (providerName: string) => Promise<boolean>;
}

const TABS = ["AI", "Voice", "Vision", "Screen", "Privacy & Security", "Appearance", "System"] as const;
type Tab = typeof TABS[number];

export function SettingsPage({ settings, onChange, onSave, onSaveProviderKey, onRemoveProviderKey, onTestProviderKey }: Props) {
  const [tab, setTab] = useState<Tab>("AI");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, "idle" | "testing" | "ok" | "fail">>({});

  function patch<K extends keyof JarvisSettings>(section: K, value: JarvisSettings[K]): void {
    const next = { ...settings, [section]: value };
    const result = validateSettings(next);
    if (!result.valid) {
      setSaveError(result.errors.join("; "));
      return;
    }
    setSaveError(null);
    onChange(next);
  }

  async function handleTestKey(name: string): Promise<void> {
    setTestResults((r) => ({ ...r, [name]: "testing" }));
    try {
      const ok = await onTestProviderKey(name);
      setTestResults((r) => ({ ...r, [name]: ok ? "ok" : "fail" }));
    } catch {
      setTestResults((r) => ({ ...r, [name]: "fail" }));
    }
  }

  return (
    <div className="settings-page">
      <nav className="settings-tabs">
        {TABS.map((t) => (
          <button key={t} className={`settings-tab ${tab === t ? "settings-tab--active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <div className="settings-content">
        {tab === "AI" && (
          <div>
            <h3>AI Providers</h3>
            {aiProviderRegistry.allConfigs().map((cfg) => {
              const status = aiProviderRegistry.getStatus(cfg.name);
              return (
                <div key={cfg.name} className="settings-provider-row">
                  <label>
                    <input type="checkbox" checked={cfg.enabled} onChange={(e) => aiProviderRegistry.updateConfig(cfg.name, { enabled: e.target.checked })} />
                    {cfg.displayName}
                  </label>
                  <span className={`ar-badge ${cfg.hasApiKey ? "ar-badge--tracking" : ""}`}>{cfg.hasApiKey ? "key configured" : "no key"}</span>
                  <span className="ar-badge">{status?.availability ?? "unknown"}</span>
                  <input
                    type="password"
                    placeholder="API key"
                    value={keyInputs[cfg.name] ?? ""}
                    onChange={(e) => setKeyInputs((k) => ({ ...k, [cfg.name]: e.target.value }))}
                  />
                  <button className="studio-toolbar-btn" onClick={async () => {
                    // onSaveProviderKey (App.tsx) is the authoritative
                    // path — it constructs the REAL provider instance and
                    // updates the registry config together, so a
                    // redundant updateConfig call here isn't needed (and
                    // was removed to avoid two code paths disagreeing
                    // about hasApiKey during this phase's completion pass).
                    await onSaveProviderKey(cfg.name, keyInputs[cfg.name] ?? "");
                    setKeyInputs((k) => ({ ...k, [cfg.name]: "" }));
                  }}>Save</button>
                  <button className="studio-toolbar-btn" onClick={() => handleTestKey(cfg.name)}>
                    {testResults[cfg.name] === "testing" ? "Testing..." : "Test"}
                  </button>
                  <button className="studio-toolbar-btn" onClick={async () => {
                    await onRemoveProviderKey(cfg.name);
                  }}>Remove</button>
                </div>
              );
            })}

            <h3>Behavior</h3>
            <label>Default provider
              <select value={settings.ai.defaultProvider ?? ""} onChange={(e) => patch("ai", { ...settings.ai, defaultProvider: e.target.value || null })}>
                <option value="">Auto (highest priority)</option>
                {aiProviderRegistry.list().map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>Fallback behavior
              <select value={settings.ai.fallbackBehavior} onChange={(e) => patch("ai", { ...settings.ai, fallbackBehavior: e.target.value as "strict" | "fallback" })}>
                <option value="fallback">Fall back to next available provider</option>
                <option value="strict">Only use the selected provider</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={settings.ai.streamingEnabled} onChange={(e) => patch("ai", { ...settings.ai, streamingEnabled: e.target.checked })} />
              Streaming responses
            </label>
          </div>
        )}

        {tab === "Voice" && (
          <div>
            <label>Speech speed ({settings.voice.speechSpeed.toFixed(1)}x)
              <input type="range" min={0.5} max={2} step={0.1} value={settings.voice.speechSpeed}
                onChange={(e) => patch("voice", { ...settings.voice, speechSpeed: parseFloat(e.target.value) })} />
            </label>
            <label><input type="checkbox" checked={settings.voice.wakeWordEnabled} onChange={(e) => patch("voice", { ...settings.voice, wakeWordEnabled: e.target.checked })} /> Wake word</label>
            <label><input type="checkbox" checked={settings.voice.interruptionEnabled} onChange={(e) => patch("voice", { ...settings.voice, interruptionEnabled: e.target.checked })} /> Allow interruption</label>
          </div>
        )}

        {tab === "Vision" && (
          <div>
            <label><input type="checkbox" checked={settings.vision.cameraEnabled} onChange={(e) => patch("vision", { ...settings.vision, cameraEnabled: e.target.checked })} /> Camera</label>
            <label><input type="checkbox" checked={settings.vision.handTrackingEnabled} onChange={(e) => patch("vision", { ...settings.vision, handTrackingEnabled: e.target.checked })} /> Hand tracking</label>
            <label><input type="checkbox" checked={settings.vision.faceTrackingEnabled} onChange={(e) => patch("vision", { ...settings.vision, faceTrackingEnabled: e.target.checked })} /> Face tracking</label>
            <label><input type="checkbox" checked={settings.vision.poseTrackingEnabled} onChange={(e) => patch("vision", { ...settings.vision, poseTrackingEnabled: e.target.checked })} /> Pose tracking</label>
          </div>
        )}

        {tab === "Screen" && (
          <div>
            <label><input type="checkbox" checked={settings.screen.screenCaptureEnabled} onChange={(e) => patch("screen", { ...settings.screen, screenCaptureEnabled: e.target.checked })} /> Screen capture enabled</label>
            <label><input type="checkbox" checked={settings.screen.screenAnalysisEnabled} onChange={(e) => patch("screen", { ...settings.screen, screenAnalysisEnabled: e.target.checked })} /> Screen analysis</label>
            <label>Capture mode
              <select value={settings.screen.captureMode} onChange={(e) => patch("screen", { ...settings.screen, captureMode: e.target.value as JarvisSettings["screen"]["captureMode"] })}>
                <option value="screenshot">Screenshot</option>
                <option value="active_window">Active window</option>
                <option value="selected_monitor">Selected monitor</option>
                <option value="full_screen">Full screen</option>
              </select>
            </label>
            <p className="settings-note">Continuous capture is not an implemented feature — each capture requires an explicit action and a fresh permission prompt.</p>
          </div>
        )}

        {tab === "Privacy & Security" && (
          <div>
            <label><input type="checkbox" checked={settings.privacy.cameraAllowed} onChange={(e) => patch("privacy", { ...settings.privacy, cameraAllowed: e.target.checked })} /> Allow camera</label>
            <label><input type="checkbox" checked={settings.privacy.microphoneAllowed} onChange={(e) => patch("privacy", { ...settings.privacy, microphoneAllowed: e.target.checked })} /> Allow microphone</label>
            <label><input type="checkbox" checked={settings.privacy.screenAllowed} onChange={(e) => patch("privacy", { ...settings.privacy, screenAllowed: e.target.checked })} /> Allow screen capture</label>
            <label><input type="checkbox" checked={settings.privacy.fileAccessAllowed} onChange={(e) => patch("privacy", { ...settings.privacy, fileAccessAllowed: e.target.checked })} /> Allow file access</label>
            <label>
              <input type="checkbox" checked disabled />
              Dangerous-action confirmations (always on — cannot be disabled)
            </label>
            <label>Data retention (days)
              <input type="number" min={0} value={settings.privacy.dataRetentionDays} onChange={(e) => patch("privacy", { ...settings.privacy, dataRetentionDays: parseInt(e.target.value, 10) || 0 })} />
            </label>
          </div>
        )}

        {tab === "Appearance" && (
          <div>
            <label>Animation quality
              <select value={settings.appearance.animationQuality} onChange={(e) => patch("appearance", { ...settings.appearance, animationQuality: e.target.value as JarvisSettings["appearance"]["animationQuality"] })}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </label>
            <label><input type="checkbox" checked={settings.appearance.reducedMotion} onChange={(e) => patch("appearance", { ...settings.appearance, reducedMotion: e.target.checked })} /> Reduced motion</label>
            <label>Density
              <select value={settings.appearance.density} onChange={(e) => patch("appearance", { ...settings.appearance, density: e.target.value as JarvisSettings["appearance"]["density"] })}>
                <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
              </select>
            </label>
          </div>
        )}

        {tab === "System" && (
          <div>
            <label><input type="checkbox" checked={settings.system.startOnLogin} onChange={(e) => patch("system", { ...settings.system, startOnLogin: e.target.checked })} /> Start on login</label>
            <label><input type="checkbox" checked={settings.system.notificationsEnabled} onChange={(e) => patch("system", { ...settings.system, notificationsEnabled: e.target.checked })} /> Notifications</label>
            <label><input type="checkbox" checked={settings.system.diagnosticsEnabled} onChange={(e) => patch("system", { ...settings.system, diagnosticsEnabled: e.target.checked })} /> Diagnostics</label>
          </div>
        )}
      </div>

      {saveError && <p className="settings-error">{saveError}</p>}
      <button className="studio-toolbar-btn studio-toolbar-btn--nav" onClick={onSave}>Save Settings</button>
    </div>
  );
}
