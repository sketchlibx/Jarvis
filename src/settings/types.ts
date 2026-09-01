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
}

export interface VoiceSettings {
  sttProvider: string;
  ttsProvider: string;
  voice: string;
  speechSpeed: number; // 0.5..2.0
  wakeWordEnabled: boolean;
  interruptionEnabled: boolean;
}

export interface VisionSettings {
  cameraEnabled: boolean;
  handTrackingEnabled: boolean;
  faceTrackingEnabled: boolean;
  poseTrackingEnabled: boolean;
}

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
  vision: VisionSettings;
  screen: ScreenSettings;
  privacy: PrivacySettings;
  appearance: AppearanceSettings;
  system: SystemSettings;
}

export const SETTINGS_SCHEMA_VERSION = "1.0";

export const DEFAULT_SETTINGS: JarvisSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  ai: { defaultProvider: null, fallbackBehavior: "fallback", temperature: 0.7, streamingEnabled: true },
  voice: { sttProvider: "web_speech", ttsProvider: "web_speech", voice: "default", speechSpeed: 1.0, wakeWordEnabled: false, interruptionEnabled: true },
  vision: { cameraEnabled: false, handTrackingEnabled: false, faceTrackingEnabled: false, poseTrackingEnabled: false },
  screen: { screenCaptureEnabled: false, screenAnalysisEnabled: false, captureMode: "screenshot", continuousCaptureBlocked: true },
  privacy: { cameraAllowed: false, microphoneAllowed: false, screenAllowed: false, fileAccessAllowed: false, dangerousActionConfirmationsEnabled: true, dataRetentionDays: 30 },
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
  }

  const voice = s.voice as Record<string, unknown> | undefined;
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
