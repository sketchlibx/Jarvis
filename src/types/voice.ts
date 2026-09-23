export type MicStatus = "unavailable" | "permission_denied" | "idle" | "starting" | "listening" | "processing" | "error";
export type SpeakStatus = "idle" | "speaking" | "error";

export interface SpeechToTextProvider {
  readonly providerName: string;
  startListening(): Promise<void>;   // starts the recognizer; may remain live in continuous mode
  stopListening(): Promise<string>;  // stops the current capture window and resolves with transcript
  abort(): void;
  onStatusChange(cb: (status: MicStatus) => void): () => void;
  /** Synchronous read of the current status — used for re-entrancy guards
   * where waiting for the next onStatusChange callback would be too late
   * (a fast double-tap can fire before React state has re-rendered). */
  getStatus(): MicStatus;
  /** Optional low-overhead hook for wake-word fallback and hands-free command
   * segmentation. It emits only recognizer-final text and never creates a
   * second microphone/recognizer instance.
   * It is emitted only for recognizer-final text and does not create a second
   * microphone/recognizer instance. */
  onFinalTranscript?(cb: (transcript: string) => void): () => void;
}

export interface TextToSpeechProvider {
  readonly providerName: string;
  speak(text: string, signal?: AbortSignal): Promise<void>;
  stop(): void;
  onStatusChange(cb: (status: SpeakStatus) => void): () => void;
  /** Optional: providers that support live rate/pitch/volume/voice
   * changes expose this so Settings can apply them without recreating
   * the whole VoiceProvider (which would drop listeners for no reason).
   * Optional because not every conceivable TTS provider necessarily
   * supports changing these after construction. */
  updateConfig?(config: { rate?: number; pitch?: number; volume?: number; voiceName?: string }): void;
  /** Optional: real, already-installed voices this provider can use —
   * for a Settings voice picker. Absent/undefined for providers with no
   * concept of selectable voices. */
  listAvailableVoices?(): Promise<SpeechSynthesisVoice[]>;
}

export interface VoiceProvider {
  stt: SpeechToTextProvider;
  tts: TextToSpeechProvider;
  /**
   * Wake-word hook. The Web Speech build supplies a transcript-backed
   * implementation that shares the existing recognizer; no second microphone
   * is opened. Native low-power wake-word engines can still be swapped in later.
   * Optional only so a VoiceProvider
   * implementation with no wake-word concept at all remains valid.
   */
  wakeWord?: WakeWordProvider;
}

// ---------------------------------------------------------------------
// Wake word — shared-recognizer fallback contract.
// ---------------------------------------------------------------------

export interface WakeWordProvider {
  start(): Promise<void>;
  stop(): void;
  isListening(): boolean;
  onWakeWord(cb: () => void): () => void;
}
