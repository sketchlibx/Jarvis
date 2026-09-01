export interface JarvisSettings {
  aiProvider: "claude" | "openai" | "local";
  // API keys are NEVER stored in this object at rest in plaintext JSON —
  // this type only describes the *shape*; the actual value is written via
  // Tauri's secure storage (OS keychain, see SECURITY.md) and only held
  // in memory here at runtime.
  voiceProvider: string;
  ttsVoice: string;
  micDeviceId: string | null;
  cameraDeviceId: string | null;
  memoryEnabled: boolean;
  theme: "dark" | "light" | "system";
  startOnLogin: boolean;
  pushToTalkKey: string; // e.g. "F13" or a configurable hotkey string

  // Phase 3 — perception privacy controls (spec section 18).
  // Independently toggleable: disabling one modality contributes NO vote
  // to state fusion at all (see StateFusionEngine), never a neutral one.
  emotionDetectionEnabled: boolean;
  cameraBasedStateEnabled: boolean;
  voiceBasedStateEnabled: boolean;
  behaviorBasedStateEnabled: boolean;
}

export const DEFAULT_SETTINGS: JarvisSettings = {
  aiProvider: "claude",
  voiceProvider: "none",
  ttsVoice: "default",
  micDeviceId: null,
  cameraDeviceId: null,
  memoryEnabled: true,
  theme: "dark",
  startOnLogin: false,
  pushToTalkKey: "F13",

  // Off by default — the spec's privacy framing ("allow user to disable")
  // reads most naturally as opt-in for something this sensitive, so Phase 3
  // ships with emotion/state estimation OFF until the person turns it on.
  emotionDetectionEnabled: false,
  cameraBasedStateEnabled: false,
  voiceBasedStateEnabled: false,
  behaviorBasedStateEnabled: false,
};
