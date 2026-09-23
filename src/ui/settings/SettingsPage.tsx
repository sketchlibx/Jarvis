import { useEffect, useState } from "react";
import type { JarvisSettings } from "../../settings/types";
import { validateSettings } from "../../settings/types";
import { aiProviderRegistry } from "../../ai/AIProvider";
import { toFriendlyProviderError } from "../../ai/providerErrors";
import type { JarvisSettings as PerceptionSettings } from "../../config/settings";
import type { MemoryEntry } from "../../orchestrator/MemoryGuard";

interface Props {
  settings: JarvisSettings;
  onChange: (settings: JarvisSettings) => void;
  onSave: () => Promise<void>;
  onSaveProviderKey: (providerName: string, key: string, extra?: {
    baseUrl?: string;
    model?: string;
    voiceId?: string;
    modelId?: string;
  }) => Promise<void>;
  onRemoveProviderKey: (providerName: string) => Promise<void>;
  /** Real voices window.speechSynthesis actually reports on this machine
   * — never a hardcoded list. See WebSpeechProvider.ts's waitForVoices(). */
  onListVoices: () => Promise<SpeechSynthesisVoice[]>;
  /** Speaks a short real sentence with the CURRENTLY configured
   * rate/pitch/volume/voice via the real TTS provider — lets the person
   * hear their settings before committing, not a simulated preview. */
  onTestVoice: () => Promise<void>;
  /** True once a real startup attempt to start wake-word detection has
   * genuinely failed (see WakeWordProvider.ts) — drives an honest note in
   * the UI rather than a checkbox that silently does nothing. */
  wakeWordUnavailable: boolean;
  onTestProviderKey: (providerName: string) => Promise<boolean>;
  /** REAL bug found and fixed this session: SettingsPage previously had no
   * way back to Home at all — it's a fully separate top-level view (see
   * App.tsx's `if (view === "settings") return <SettingsPage .../>`), and
   * no exit control was ever wired to it, unlike DesignStudio which always
   * had one. Verifying "every route" surfaced this as a real dead end, not
   * a cosmetic issue. */
  onExit: () => void;
  /** The REAL, live Phase 3 perception settings object — see the Vision
   * tab's implementation comment and PHASE-CONTINUITY.md gap #6. */
  visionSettings: PerceptionSettings;
  onVisionSettingsChange: (settings: PerceptionSettings) => void;
  /** Real memory list + actions — see PHASE-CONTINUITY.md gap #1 (fixed
   * this session). Only ever contains APPROVED entries
   * (MemoryOrchestrator.retrieveApprovedMemories's own guarantee) — never
   * shows unapproved AI-inferred proposals here, since surfacing those
   * would itself undermine the consent model. */
  memories: MemoryEntry[];
  memoriesLoading: boolean;
  onDeleteMemory: (id: string) => Promise<void>;
  onRefreshMemories: () => Promise<void>;
}

const TABS = ["AI", "Voice", "Vision", "Screen", "Memory", "Privacy & Security", "Appearance", "System"] as const;
type Tab = typeof TABS[number];

export function SettingsPage({
  settings, onChange, onSave, onSaveProviderKey, onRemoveProviderKey, onTestProviderKey, onExit,
  onListVoices, onTestVoice, wakeWordUnavailable,
  visionSettings, onVisionSettingsChange, memories, memoriesLoading, onDeleteMemory, onRefreshMemories,
}: Props) {
  const [tab, setTab] = useState<Tab>("AI");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [baseUrlInputs, setBaseUrlInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, "idle" | "testing" | "ok" | "fail">>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceTestState, setVoiceTestState] = useState<"idle" | "testing" | "error">("idle");
  const [voiceTestError, setVoiceTestError] = useState<string | null>(null);
  const [elevenKey, setElevenKey] = useState("");
  const [elevenKeyState, setElevenKeyState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    if (tab === "Voice") {
      onListVoices().then((v) => { if (!cancelled) setVoices(v); });
    }
    return () => { cancelled = true; };
  }, [tab, onListVoices]);

  /** Single source of truth for the visible status label — spec's
   * required language ("Connected / Not configured / Connection failed /
   * Testing...") derived from real state, never fabricated. A key
   * existing does not by itself mean "Connected" — only a successful
   * test or a successful real call earns that label. */
  function providerStatusLabel(cfg: { hasApiKey: boolean; name: string }): { text: string; tone: "ok" | "warn" | "error" | "neutral" } {
    if (testResults[cfg.name] === "testing") return { text: "Testing…", tone: "neutral" };
    if (!cfg.hasApiKey) return { text: "Not configured", tone: "neutral" };
    if (testResults[cfg.name] === "fail") return { text: "Connection failed", tone: "error" };
    if (testResults[cfg.name] === "ok") return { text: "Connected", tone: "ok" };
    return { text: "Key saved — not yet tested", tone: "warn" };
  }

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
    } catch (err) {
      // "Connection failed" is the correct clean label either way — the
      // real reason still goes to the console (same discipline as
      // toFriendlyProviderError) so it's not silently swallowed for
      // anyone actually debugging a failed test.
      // eslint-disable-next-line no-console
      console.error("[jarvis:provider:test]", err);
      setTestResults((r) => ({ ...r, [name]: "fail" }));
    }
  }

  return (
    <div className="settings-page">
      <nav className="settings-tabs">
        <button className="settings-tab settings-tab--back" onClick={onExit}>‹ Back</button>
        {TABS.map((t) => (
          <button key={t} className={`settings-tab ${tab === t ? "settings-tab--active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <div className="settings-content">
        {tab === "AI" && (
          <div>
            <h3>AI Providers</h3>
            {aiProviderRegistry.allConfigs().map((cfg) => {
              const statusLabel = providerStatusLabel(cfg);
              const currentInput = keyInputs[cfg.name] ?? "";
              const isSaving = savingKey[cfg.name] === true;
              const isOpenAiCompatible = cfg.name === "openai_compatible";
              const currentBaseUrl = baseUrlInputs[cfg.name] ?? cfg.baseUrl ?? "";
              const currentModel = modelInputs[cfg.name] ?? (cfg.model !== "default" ? cfg.model : "");
              // openai_compatible has no built-in endpoint — Save stays
              // disabled until baseUrl+model are ALSO filled in, not just
              // the key (see OpenAICompatibleGenericProvider's constructor
              // guard, which would otherwise just reject the save).
              const missingRequiredFields = isOpenAiCompatible && (currentBaseUrl.trim().length === 0 || currentModel.trim().length === 0);
              return (
                <div key={cfg.name} className="settings-provider-row">
                  <label className="settings-provider-name">
                    <input type="checkbox" checked={cfg.enabled} onChange={(e) => aiProviderRegistry.updateConfig(cfg.name, { enabled: e.target.checked })} />
                    {cfg.displayName}
                  </label>
                  <span className={`ar-badge settings-status-badge settings-status-badge--${statusLabel.tone}`}>{statusLabel.text}</span>
                  {isOpenAiCompatible && (
                    <>
                      <input
                        type="text"
                        placeholder="Base URL (e.g. https://your-endpoint/v1)"
                        value={currentBaseUrl}
                        onChange={(e) => setBaseUrlInputs((b) => ({ ...b, [cfg.name]: e.target.value }))}
                      />
                      <input
                        type="text"
                        placeholder="Model name"
                        value={currentModel}
                        onChange={(e) => setModelInputs((m) => ({ ...m, [cfg.name]: e.target.value }))}
                      />
                    </>
                  )}
                  <input
                    type="password"
                    placeholder={cfg.hasApiKey ? "•••••••• (enter a new key to change it)" : "Paste API key"}
                    value={currentInput}
                    onChange={(e) => { setKeyInputs((k) => ({ ...k, [cfg.name]: e.target.value })); setKeyErrors((k) => ({ ...k, [cfg.name]: null })); }}
                  />
                  <button
                    className="studio-toolbar-btn"
                    disabled={currentInput.trim().length === 0 || isSaving || missingRequiredFields}
                    onClick={async () => {
                      setSavingKey((s) => ({ ...s, [cfg.name]: true }));
                      setKeyErrors((k) => ({ ...k, [cfg.name]: null }));
                      try {
                        // onSaveProviderKey (App.tsx) is the authoritative
                        // path — it constructs the REAL provider instance
                        // and updates the registry config together.
                        await onSaveProviderKey(
                          cfg.name, currentInput.trim(),
                          isOpenAiCompatible ? { baseUrl: currentBaseUrl.trim(), model: currentModel.trim() } : undefined
                        );
                        setKeyInputs((k) => ({ ...k, [cfg.name]: "" }));
                        setTestResults((r) => ({ ...r, [cfg.name]: "idle" })); // a new key invalidates any prior test result — don't keep showing a stale "Connected"
                      } catch (err) {
                        // Root cause investigated and fixed this session
                        // (see providerErrors.ts's doc comment) — this
                        // used to render err.message RAW, which is how a
                        // Tauri-bridge-missing error like "Cannot read
                        // properties of undefined (reading 'invoke')"
                        // ended up directly in the Settings UI. The full
                        // technical error is still logged to the console
                        // (see toFriendlyProviderError) — only the
                        // ON-SCREEN string is sanitized.
                        setKeyErrors((k) => ({ ...k, [cfg.name]: toFriendlyProviderError(err, "save") }));
                      } finally {
                        setSavingKey((s) => ({ ...s, [cfg.name]: false }));
                      }
                    }}
                  >
                    {isSaving ? "Saving…" : cfg.hasApiKey ? "Update" : "Save"}
                  </button>
                  <button className="studio-toolbar-btn" disabled={!cfg.hasApiKey} onClick={() => handleTestKey(cfg.name)}>
                    {testResults[cfg.name] === "testing" ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    className="studio-toolbar-btn"
                    disabled={!cfg.hasApiKey}
                    onClick={async () => {
                      try {
                        await onRemoveProviderKey(cfg.name);
                        setTestResults((r) => ({ ...r, [cfg.name]: "idle" }));
                        setKeyErrors((k) => ({ ...k, [cfg.name]: null }));
                      } catch (err) {
                        // Previously unhandled entirely — a failed remove
                        // (e.g. keychain access error) silently did
                        // nothing, leaving the user unsure whether it
                        // worked. Now it fails visibly, same pattern as Save.
                        setKeyErrors((k) => ({ ...k, [cfg.name]: toFriendlyProviderError(err, "remove") }));
                      }
                    }}
                  >
                    Remove
                  </button>
                  {keyErrors[cfg.name] && <p className="settings-error settings-provider-error">{keyErrors[cfg.name]}</p>}
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
            <label>Request timeout (seconds)
              <input
                type="number"
                min={5}
                max={300}
                value={settings.ai.requestTimeoutSeconds}
                onChange={(e) => patch("ai", { ...settings.ai, requestTimeoutSeconds: Number(e.target.value) })}
              />
            </label>
            <p className="settings-note">
              A provider call that hangs longer than this is cancelled automatically so the assistant never gets stuck waiting. "Stop"/"Cancel" also cancels an in-flight request immediately.
            </p>
          </div>
        )}

        {tab === "Voice" && (
          <div>
            <h3>Voice</h3>
            <label> TTS engine
              <select value={settings.voice.ttsProvider} onChange={(e) => patch("voice", { ...settings.voice, ttsProvider: e.target.value })}>
                <option value="kokoro">Kokoro Local · free</option>
                <option value="web_speech">Windows / Web Speech</option>
                <option value="elevenlabs">ElevenLabs · optional paid API</option>
              </select>
            </label>
            <div className="settings-provider-row settings-voice-provider-card">
              <div>
                <strong>Kokoro · Local TTS</strong>
                <p className="settings-note">Runs locally in JARVIS after the model is cached. No API key, subscription, or per-request payment. First use downloads the model once from the public model repository.</p>
              </div>
              <span className={`ar-badge settings-status-badge settings-status-badge--${settings.voice.ttsProvider === "kokoro" ? "ok" : "neutral"}`}>
                {settings.voice.ttsProvider === "kokoro" ? "Active" : "Not active"}
              </span>
              <select value={settings.voice.kokoroVoice} onChange={(e) => patch("voice", { ...settings.voice, kokoroVoice: e.target.value })}>
                <option value="am_michael">Michael · American male</option>
                <option value="am_fenrir">Fenrir · American male</option>
                <option value="am_puck">Puck · American male</option>
                <option value="am_adam">Adam · American male</option>
                <option value="am_onyx">Onyx · American male</option>
                <option value="am_echo">Echo · American male</option>
                <option value="am_eric">Eric · American male</option>
                <option value="am_liam">Liam · American male</option>
                <option value="bm_george">George · British male</option>
                <option value="bm_fable">Fable · British male</option>
                <option value="bm_daniel">Daniel · British male</option>
                <option value="bm_lewis">Lewis · British male</option>
                <option value="af_heart">Heart · American female</option>
                <option value="af_bella">Bella · American female</option>
                <option value="af_nicole">Nicole · American female</option>
                <option value="af_sarah">Sarah · American female</option>
                <option value="af_sky">Sky · American female</option>
                <option value="bf_emma">Emma · British female</option>
                <option value="bf_isabella">Isabella · British female</option>
                <option value="bf_alice">Alice · British female</option>
                <option value="bf_lily">Lily · British female</option>
              </select>
              <div className="settings-provider-actions">
                <button className="studio-toolbar-btn" onClick={() => patch("voice", { ...settings.voice, ttsProvider: "kokoro" })}>Use Kokoro</button>
                <button className="studio-toolbar-btn" disabled={voiceTestState === "testing" || settings.voice.ttsProvider !== "kokoro"} onClick={async()=>{
                  setVoiceTestState("testing");
                  setVoiceTestError(null);
                  try {
                    await onTestVoice();
                    setVoiceTestState("idle");
                  } catch (error) {
                    setVoiceTestState("error");
                    setVoiceTestError(error instanceof Error ? error.message : String(error));
                  }
                }}>{voiceTestState === "testing" ? "Testing…" : voiceTestState === "error" && settings.voice.ttsProvider === "kokoro" ? "Try again" : "Test Kokoro"}</button>
              </div>
              <p className="settings-note">The current model is the q8 ONNX build (about 92 MB for the model weights). The browser/WebView performs inference locally; internet is only needed for the initial model download/cache.</p>
            </div>
            <div className="settings-provider-row settings-voice-provider-card">
              <div>
                <strong>ElevenLabs · Noel J (optional)</strong>
                <p className="settings-note">Real cloud TTS. API key is stored in the OS keychain; it is never written to settings JSON.</p>
              </div>
              <span className={`ar-badge settings-status-badge settings-status-badge--${settings.voice.ttsProvider === "elevenlabs" ? "ok" : "neutral"}`}>
                {settings.voice.ttsProvider === "elevenlabs" ? "Active" : "Not active"}
              </span>
              <input type="password" placeholder="Paste ElevenLabs API key" value={elevenKey} onChange={e=>setElevenKey(e.target.value)} />
              <input type="text" value={settings.voice.elevenLabsVoiceId} onChange={e=>patch("voice", { ...settings.voice, elevenLabsVoiceId: e.target.value })} placeholder="Voice ID" />
              <select value={settings.voice.elevenLabsModel} onChange={e=>patch("voice", { ...settings.voice, elevenLabsModel: e.target.value as typeof settings.voice.elevenLabsModel })}>
                <option value="eleven_flash_v2_5">Flash v2.5 · low latency</option>
                <option value="eleven_multilingual_v2">Multilingual v2 · quality</option>
                <option value="eleven_turbo_v2_5">Turbo v2.5 · legacy low latency</option>
                <option value="eleven_v3">v3 · expressive</option>
                <option value="eleven_v4">v4 · latest expressive</option>
              </select>
              <div className="settings-provider-actions">
                <button className="studio-toolbar-btn" disabled={!elevenKey.trim() || elevenKeyState === "saving"} onClick={async()=>{
                  setElevenKeyState("saving");
                  setVoiceTestError(null);
                  try {
                    await onSaveProviderKey("elevenlabs", elevenKey.trim(), {
                      voiceId: settings.voice.elevenLabsVoiceId,
                      modelId: settings.voice.elevenLabsModel,
                    });
                    setElevenKey("");
                    setElevenKeyState("saved");
                  } catch {
                    setElevenKeyState("error");
                  }
                }}>{elevenKeyState === "saving" ? "Saving…" : elevenKeyState === "saved" ? "Saved" : "Save ElevenLabs"}</button>
                <button className="studio-toolbar-btn" disabled={settings.voice.ttsProvider !== "elevenlabs" || voiceTestState === "testing"} onClick={async()=>{
                  setVoiceTestState("testing");
                  setVoiceTestError(null);
                  try {
                    await onTestVoice();
                    setVoiceTestState("idle");
                  } catch (error) {
                    setVoiceTestState("error");
                    setVoiceTestError(error instanceof Error ? error.message : String(error));
                  }
                }}>{voiceTestState === "testing" ? "Testing…" : voiceTestState === "error" ? "Try again" : "Test Noel J"}</button>
              </div>
              {elevenKeyState === "error" && <p className="settings-error">Could not save the ElevenLabs key.</p>}
              {voiceTestError && <p className="settings-error settings-error--detail">{settings.voice.ttsProvider === "kokoro" ? "Kokoro test failed" : "TTS test failed"}: {voiceTestError}</p>}
            </div>
            <label>Speech speed ({settings.voice.speechSpeed.toFixed(1)}x)
              <input type="range" min={0.5} max={2} step={0.1} value={settings.voice.speechSpeed}
                onChange={(e) => patch("voice", { ...settings.voice, speechSpeed: parseFloat(e.target.value) })} />
            </label>
            <label>Pitch ({settings.voice.pitch.toFixed(2)})
              <input type="range" min={0.5} max={2} step={0.05} value={settings.voice.pitch}
                onChange={(e) => patch("voice", { ...settings.voice, pitch: parseFloat(e.target.value) })} />
            </label>
            <label>Volume ({Math.round(settings.voice.volume * 100)}%)
              <input type="range" min={0} max={1} step={0.05} value={settings.voice.volume}
                onChange={(e) => patch("voice", { ...settings.voice, volume: parseFloat(e.target.value) })} />
            </label>
            <label>Voice
              <select value={settings.voice.voice} onChange={(e) => patch("voice", { ...settings.voice, voice: e.target.value })}>
                <option value="default">Automatic (best available)</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang}){v.localService ? "" : " · online"}</option>
                ))}
              </select>
            </label>
            {voices.length === 0 && (
              <p className="settings-note">
                No system voices were reported yet by this WebView. Windows' higher-quality "Natural" voices
                (Settings → Time &amp; Language → Speech) will appear here once available — "Automatic" will
                prefer one of those over the default voice when present.
              </p>
            )}
            <button
              className="studio-toolbar-btn"
              disabled={voiceTestState === "testing"}
              onClick={async () => {
                setVoiceTestState("testing");
                setVoiceTestError(null);
                try {
                  await onTestVoice();
                  setVoiceTestState("idle");
                } catch (error) {
                  setVoiceTestState("error");
                  setVoiceTestError(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              {voiceTestState === "testing" ? "Speaking…" : voiceTestState === "error" ? "Playback failed — try again" : "Test voice"}
            </button>
            {voiceTestError && <p className="settings-error settings-error--detail">Voice test failed: {voiceTestError}</p>}
            <label><input type="checkbox" checked={settings.voice.continuousListeningEnabled} onChange={(e) => patch("voice", { ...settings.voice, continuousListeningEnabled: e.target.checked })} /> Start listening on launch</label>
            <label><input type="checkbox" checked={settings.voice.wakeWordEnabled} onChange={(e) => patch("voice", { ...settings.voice, wakeWordEnabled: e.target.checked })} /> Wake word</label>
            {settings.voice.wakeWordEnabled && wakeWordUnavailable && (
              <p className="settings-note">
                This build uses the same live speech recognizer for a real transcript-backed "Hey JARVIS" fallback. It does not open a second microphone. A native low-power offline wake model is still a future enhancement.
              </p>
            )}
            <label><input type="checkbox" checked={settings.voice.interruptionEnabled} onChange={(e) => patch("voice", { ...settings.voice, interruptionEnabled: e.target.checked })} /> Allow interruption</label>
          </div>
        )}

        {tab === "Vision" && (
          <div>
            {/* Phase 7: controls the REAL Phase 3 settings object
                (config/settings.ts) that VisionPipeline/StateFusionEngine
                actually read — see PHASE-CONTINUITY.md gap #6, now fixed.
                No separate/disconnected copy exists anymore. */}
            <h3>Vision</h3>
            <label>
              <input type="checkbox" checked={visionSettings.handTrackingEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, handTrackingEnabled: e.target.checked })} />
              Hand tracking
            </label>
            <label>
              <input type="checkbox" checked={visionSettings.cameraBasedStateEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, cameraBasedStateEnabled: e.target.checked })} />
              Face tracking
            </label>
            <label>
              <input type="checkbox" checked={visionSettings.poseTrackingEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, poseTrackingEnabled: e.target.checked })} />
              Motion / pose tracking
            </label>
            <p className="settings-note">
              Hand and upper-body pose landmarks are processed only after you explicitly start the camera. Camera on/off itself is controlled by the camera control in the main view.
            </p>
            <h3>Perception &amp; state estimation privacy</h3>
            <label>
              <input type="checkbox" checked={visionSettings.emotionDetectionEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, emotionDetectionEnabled: e.target.checked })} />
              Emotion/state estimation (off by default)
            </label>
            <label>
              <input type="checkbox" checked={visionSettings.voiceBasedStateEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, voiceBasedStateEnabled: e.target.checked })} />
              Voice contributes to state estimate
            </label>
            <label>
              <input type="checkbox" checked={visionSettings.behaviorBasedStateEnabled} onChange={(e) => onVisionSettingsChange({ ...visionSettings, behaviorBasedStateEnabled: e.target.checked })} />
              Behavior contributes to state estimate
            </label>
          </div>
        )}

        {tab === "Screen" && (
          <div>
            <h3>Screen Capture</h3>
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

        {tab === "Memory" && (
          <div>
            <h3>Memory</h3>
            <p className="settings-note">
              Only memories you or JARVIS have proposed AND you have approved appear here — an AI-inferred suggestion never shows up until it's been confirmed. Deleting a memory here removes it permanently.
            </p>
            <button className="studio-toolbar-btn" onClick={() => onRefreshMemories()} disabled={memoriesLoading}>
              {memoriesLoading ? "Loading…" : "Refresh"}
            </button>
            {memories.length === 0 && !memoriesLoading && <p className="settings-empty">No approved memories yet.</p>}
            <ul className="settings-memory-list">
              {memories.map((m) => (
                <li key={m.id} className="settings-memory-row">
                  <span className="ar-badge">{m.category.replace(/_/g, " ")}</span>
                  <span className="settings-memory-content">{m.content}</span>
                  <button className="studio-toolbar-btn" onClick={() => onDeleteMemory(m.id)}>Delete</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "Privacy & Security" && (
          <div>
            <h3>Privacy &amp; Security</h3>
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
            <h3>Appearance</h3>
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
            <h3>System</h3>
            <label><input type="checkbox" checked={settings.system.startOnLogin} onChange={(e) => patch("system", { ...settings.system, startOnLogin: e.target.checked })} /> Start on login</label>
            <label><input type="checkbox" checked={settings.system.notificationsEnabled} onChange={(e) => patch("system", { ...settings.system, notificationsEnabled: e.target.checked })} /> Notifications</label>
            <label><input type="checkbox" checked={settings.system.diagnosticsEnabled} onChange={(e) => patch("system", { ...settings.system, diagnosticsEnabled: e.target.checked })} /> Diagnostics</label>
          </div>
        )}
      </div>

      {saveError && <p className="settings-error">{saveError}</p>}
      <button
        className="studio-toolbar-btn studio-toolbar-btn--nav"
        disabled={saveState === "saving"}
        onClick={async () => {
          setSaveState("saving");
          try {
            await onSave();
            setSaveState("saved");
            setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
          } catch {
            setSaveState("error");
          }
        }}
      >
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed — retry" : "Save Settings"}
      </button>
    </div>
  );
}
