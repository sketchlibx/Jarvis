export type MicStatus = "unavailable" | "permission_denied" | "idle" | "listening" | "processing" | "error";
export type SpeakStatus = "idle" | "speaking" | "error";

export interface SpeechToTextProvider {
  readonly providerName: string;
  startListening(): Promise<void>;   // push-to-talk: called on key/button down
  stopListening(): Promise<string>;  // called on key/button up; resolves with transcript
  abort(): void;
  onStatusChange(cb: (status: MicStatus) => void): () => void;
}

export interface TextToSpeechProvider {
  readonly providerName: string;
  speak(text: string, signal?: AbortSignal): Promise<void>;
  stop(): void;
  onStatusChange(cb: (status: SpeakStatus) => void): () => void;
}

export interface VoiceProvider {
  stt: SpeechToTextProvider;
  tts: TextToSpeechProvider;
  /**
   * Phase 3 hook. Deliberately left undefined (not stubbed with fake
   * detection) — push-to-talk is the only supported activation mode right
   * now. See WakeWordProvider below and SETUP.md "Wake word status".
   */
  onWakeWord?: (cb: () => void) => () => void;
}

// ---------------------------------------------------------------------
// Wake word — spec section 6. Interface only in Phase 3; see
// src/voice/providers/WakeWordProvider.ts for why, and SETUP.md for the
// concrete path to a real implementation.
// ---------------------------------------------------------------------

export interface WakeWordProvider {
  start(): Promise<void>;
  stop(): void;
  isListening(): boolean;
  onWakeWord(cb: () => void): () => void;
}
