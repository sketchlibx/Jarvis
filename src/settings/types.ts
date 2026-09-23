// ---------------------------------------------------------------------
// Settings data model — spec section 7's required sections. This file is
// pure data + validation; persistence happens through Rust commands
// (see src-tauri/src/commands.rs's settings_* additions) so settings
// survive restarts the same way projects already do (Phase 4's
// save/load_design_project pattern, reused here).
// ---------------------------------------------------------------------

export interface AISettings {
  defaultProvider: string | null;
  /** "strict" never falls back — matches ProviderConfig-level force
   * behavior; "fallback" lets aiProviderRegistry.route() pick the next
   * usable candidate per spec section 4. */
  fallbackBehavior: "strict" | "fallback";
  temperature: number; // 0..1, only meaningful for providers whose capabilities include it — UI should gray this out otherwise, not hide the setting entirely
  streamingEnabled: boolean;
  /** Phase 7 security/reliability pass: how long a single provider call
   * (chat/streamChat/generatePlan) is allowed to hang before it is
   * aborted automatically. Without this, a stalled network condition left
   * the state machine stuck in THINKING forever with no user-facing way
   * to recover short of restarting the app. Seconds, not ms, to keep the
   * Settings UI input a plain human-scale number. */
  requestTimeoutSeconds: number;
  /** The "openai_compatible" provider has no built-in default endpoint
   * (unlike Claude/Gemini/Grok/DeepSeek) — these two fields are the
   * "smallest architecture-compatible change" needed to configure it
   * (see OpenAICompatibleProvider.ts's OpenAICompatibleGenericProvider).
   * The API key itself still goes through the existing secure keystore,
   * NOT here — this only holds the two non-secret fields the keystore
   * has no slot for. Null until the user configures it. */
  openAiCompatibleBaseUrl: string | null;
  openAiCompatibleModel: string | null;
}

export interface VoiceSettings {
  sttProvider: string;
  ttsProvider: string;
  /** A real SpeechSynthesisVoice.name from this machine's OS/browser voice
   * list, or "default" to let pickBestVoice() choose automatically (see
   * WebSpeechProvider.ts). Never a fabricated/hardcoded voice — the
   * Settings UI only ever lists voices window.speechSynthesis.getVoices()
   * actually returned. */
  voice: string;
  speechSpeed: number; // 0.5..2.0 — SpeechSynthesisUtterance.rate
  pitch: number; // 0.5..2.0 — SpeechSynthesisUtterance.pitch
  volume: number; // 0..1 — SpeechSynthesisUtterance.volume
  wakeWordEnabled: boolean;
  continuousListeningEnabled: boolean;
  interruptionEnabled: boolean;
  /** Kokoro voice id for the local, no-API-key TTS path. */
  kokoroVoice: string;
  /** ElevenLabs voice configuration. The API key itself is never stored in settings. */
  elevenLabsVoiceId: string;
  elevenLabsModel: "eleven_flash_v2_5" | "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_v3" | "eleven_v4";
}

// NOTE (Phase 7 productization pass): `VisionSettings` was REMOVED from
// here — it was a second, disconnected copy of camera/hand/face/pose
// toggles that Phase 3's `config/settings.ts` `JarvisSettings` already
// owns LIVE (it's what `VisionPipeline` actually reads). This was
// PHASE-CONTINUITY.md's tracked gap #6 ("duplicate-settings-object
// issue"). The fix was to delete the duplicate rather than try to keep
// two objects in sync — `ui/settings/SettingsPage.tsx`'s Vision tab now
// controls the real Phase 3 object directly, passed in as a separate prop.

export type ScreenCaptureMode = "screenshot" | "active_window" | "selected_monitor" | "full_screen";

export interface ScreenSettings {
  /** Master switch — spec section 12's explicit "user must explicitly
   * enable screen perception," never on by default. */
  screenCaptureEnabled: boolean;
  screenAnalysisEnabled: boolean;
  captureMode: ScreenCaptureMode;
  /** When true, only single explicit captures are allowed — continuous
   * capture (a future capability, see ScreenCaptureProvider) stays
   * structurally unreachable while this is true, matching spec section
   * 12's "do NOT make continuous capture automatically enabled." */
  continuousCaptureBlocked: boolean;
}

export interface PrivacySettings {
  cameraAllowed: boolean;
  microphoneAllowed: boolean;
  screenAllowed: boolean;
  fileAccessAllowed: boolean;
  /** Cannot be set to false through this settings object — see
   * `validateSettings`'s explicit rejection below. Confirmation for
   * HIGH_RISK/CRITICAL actions is a Rust-side PolicyEngine guarantee
   * (Phase 2), not a toggleable JS preference. */
  dangerousActionConfirmationsEnabled: true;
  dataRetentionDays: number; // 0 = don't retain beyond the session
}

export type AnimationQuality = "low" | "medium" | "high";
export type UiDensity = "compact" | "comfortable";

export interface AppearanceSettings {
  theme: "dark" | "light";
  animationQuality: AnimationQuality;
  reducedMotion: boolean;
  density: UiDensity;
}

export interface SystemSettings {
  startOnLogin: boolean;
  notificationsEnabled: boolean;
  diagnosticsEnabled: boolean;
  logRetentionDays: number;
}

export interface JarvisSettings {
  schemaVersion: string;
  ai: AISettings;
  voice: VoiceSettings;
  screen: ScreenSettings;
  privacy: PrivacySettings;
  appearance: AppearanceSettings;
  system: SystemSettings;
}

export const SETTINGS_SCHEMA_VERSION = "1.0";

export const DEFAULT_SETTINGS: JarvisSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  ai: { defaultProvider: null, fallbackBehavior: "fallback", temperature: 0.7, streamingEnabled: true, requestTimeoutSeconds: 60, openAiCompatibleBaseUrl: null, openAiCompatibleModel: null },
  voice: { sttProvider: "web_speech", ttsProvider: "kokoro", voice: "default", kokoroVoice: "am_michael", speechSpeed: 1.0, pitch: 0.95, volume: 1.0, wakeWordEnabled: false, continuousListeningEnabled: false, interruptionEnabled: true, elevenLabsVoiceId: "oxFqodqN3UQDFjJc3bZe", elevenLabsModel: "eleven_flash_v2_5" },
  screen: { screenCaptureEnabled: false, screenAnalysisEnabled: false, captureMode: "screenshot", continuousCaptureBlocked: true },
  privacy: { cameraAllowed: false, microphoneAllowed: true, screenAllowed: false, fileAccessAllowed: false, dangerousActionConfirmationsEnabled: true, dataRetentionDays: 30 },
  appearance: { theme: "dark", animationQuality: "high", reducedMotion: false, density: "comfortable" },
  system: { startOnLogin: false, notificationsEnabled: true, diagnosticsEnabled: false, logRetentionDays: 14 },
};

export interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a settings object before it's persisted. Reject-closed, same
 * discipline as every other validator in this codebase. Two rules are
 * SECURITY rules, not just data-shape rules:
 * 1. `dangerousActionConfirmationsEnabled` must be `true` — the type
 *    itself only allows `true` (see PrivacySettings), and this validator
 *    double-checks it at the boundary in case a raw JSON blob (from disk,
 *    or a future import feature) tries to smuggle in `false`.
 * 2. `screen.continuousCaptureBlocked` must be `true` unless a future,
 *    explicit continuous-capture feature is actually built and reviewed —
 *    today, `false` is rejected outright (see spec section 12).
 */
export function validateSettings(raw: unknown): SettingsValidationResult {
  if (typeof raw !== "object" || raw === null) return { valid: false, errors: ["settings must be an object"] };
  const s = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof s.schemaVersion !== "string") errors.push("schemaVersion is required");

  const ai = s.ai as Record<string, unknown> | undefined;
  if (!ai) errors.push("ai settings missing");
  else {
    if (ai.temperature !== undefined && (typeof ai.temperature !== "number" || !Number.isFinite(ai.temperature) || ai.temperature < 0 || ai.temperature > 1)) {
      errors.push("ai.temperature must be a finite number within 0..1");
    }
    if (ai.fallbackBehavior !== undefined && ai.fallbackBehavior !== "strict" && ai.fallbackBehavior !== "fallback") {
      errors.push("ai.fallbackBehavior must be 'strict' or 'fallback'");
    }
    if (ai.requestTimeoutSeconds !== undefined && (typeof ai.requestTimeoutSeconds !== "number" || !Number.isFinite(ai.requestTimeoutSeconds) || ai.requestTimeoutSeconds < 5 || ai.requestTimeoutSeconds > 300)) {
      errors.push("ai.requestTimeoutSeconds must be a finite number within 5..300");
    }
  }

  const voice = s.voice as Record<string, unknown> | undefined;
  if (voice?.kokoroVoice !== undefined && typeof voice.kokoroVoice !== "string") errors.push("voice.kokoroVoice must be a string");
  if (voice?.speechSpeed !== undefined) {
    const v = voice.speechSpeed as number;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 2.0) errors.push("voice.speechSpeed must be within 0.5..2.0");
  }

  const privacy = s.privacy as Record<string, unknown> | undefined;
  if (privacy) {
    if (privacy.dangerousActionConfirmationsEnabled !== true) {
      errors.push("privacy.dangerousActionConfirmationsEnabled must be true — this cannot be disabled through settings");
    }
    if (privacy.dataRetentionDays !== undefined && (typeof privacy.dataRetentionDays !== "number" || privacy.dataRetentionDays < 0)) {
      errors.push("privacy.dataRetentionDays must be a non-negative number");
    }
  }

  const screen = s.screen as Record<string, unknown> | undefined;
  if (screen && screen.continuousCaptureBlocked === false) {
    errors.push("screen.continuousCaptureBlocked cannot be set to false — continuous capture is not an implemented feature (spec section 12)");
  }

  return { valid: errors.length === 0, errors };
}

export function deserializeSettings(raw: unknown): { success: boolean; settings?: JarvisSettings; errors?: string[] } {
  if (typeof raw !== "object" || raw === null) return { success: false, errors: ["settings must be an object"] };
  const result = validateSettings(raw);
  if (!result.valid) return { success: false, errors: result.errors };
  return { success: true, settings: raw as JarvisSettings };
}

export function resetSettings(): JarvisSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
