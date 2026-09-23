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

  // Added during the Phase 7 productization pass: hand tracking was
  // previously hardcoded `enableHands: true` at VisionPipeline
  // construction (see App.tsx history) — there was no way to turn it off
  // at all, let alone live. This closes that gap and, combined with
  // `cameraBasedStateEnabled` already gating face detection the same way,
  // resolves the "Vision Settings tab is decorative" / "duplicate
  // settings object" issues tracked in PHASE-CONTINUITY.md (gaps #3, #6)
  // by making THIS object — the one VisionPipeline actually reads — the
  // single thing Settings' Vision tab controls, rather than maintaining a
  // second, disconnected copy.
  handTrackingEnabled: boolean;
  poseTrackingEnabled: boolean;
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
  handTrackingEnabled: true, // preserves the prior hardcoded behavior as the DEFAULT — this pass makes it toggleable, it does not change what a fresh install does
  poseTrackingEnabled: true, // real upper-body motion tracking when the camera is explicitly started
};
