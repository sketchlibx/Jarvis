import type { SpeechToTextProvider, WakeWordProvider } from "../../types/voice";

/**
 * Functional wake-word fallback for WebSpeech/WebView2 builds.
 *
 * This does NOT open a second microphone. It subscribes to final transcripts
 * emitted by the existing STT recognizer and detects exact wake phrases such
 * as "hey jarvis" / "hello jarvis". A native low-power wake-word model is
 * still preferable for a future offline privacy-first implementation, but
 * this fallback is real, bounded, and uses the same live recognizer the app
 * already needs for automatic voice input.
 */
export class SpeechTranscriptWakeWordProvider implements WakeWordProvider {
  private listening = false;
  private unsubscribeTranscript: (() => void) | null = null;
  private callbacks = new Set<() => void>();
  private lastTriggerAt = 0;
  private transcriptWindow = "";
  private windowResetHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly phrases = [
    /^(?:hey|hello|hi)\s+jarvis\b/i,
    /\b(?:hey|hello|hi)\s+jarvis\b/i,
  ];

  constructor(private readonly stt: SpeechToTextProvider) {}

  async start(): Promise<void> {
    if (this.listening) return;
    if (!this.stt.onFinalTranscript) {
      throw new Error("Wake-word fallback requires a transcript-capable speech recognizer.");
    }
    this.listening = true;
    this.unsubscribeTranscript = this.stt.onFinalTranscript((transcript) => {
      const normalized = transcript.trim().replace(/\s+/g, " ");
      if (!normalized) return;
      this.transcriptWindow = `${this.transcriptWindow} ${normalized}`.trim().replace(/\s+/g, " ").slice(-220);
      if (this.windowResetHandle) clearTimeout(this.windowResetHandle);
      this.windowResetHandle = setTimeout(() => {
        this.transcriptWindow = "";
        this.windowResetHandle = null;
      }, 2400);
      if (!this.phrases.some((pattern) => pattern.test(this.transcriptWindow))) return;
      const now = Date.now();
      if (now - this.lastTriggerAt < 1800) return;
      this.lastTriggerAt = now;
      this.callbacks.forEach((cb) => cb());
    });
  }

  stop(): void {
    this.unsubscribeTranscript?.();
    this.unsubscribeTranscript = null;
    if (this.windowResetHandle) clearTimeout(this.windowResetHandle);
    this.windowResetHandle = null;
    this.transcriptWindow = "";
    this.listening = false;
  }

  isListening(): boolean { return this.listening && (this.stt.getStatus() === "starting" || this.stt.getStatus() === "listening"); }

  onWakeWord(cb: () => void): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }
}

/** Kept as an explicit honest provider for environments where no
 * transcript-capable STT exists. */
export class NotImplementedWakeWordProvider implements WakeWordProvider {
  isListening(): boolean { return false; }
  async start(): Promise<void> {
    throw new Error("No wake-word-capable speech recognizer is available in this WebView.");
  }
  stop(): void {}
  onWakeWord(_cb: () => void): () => void { return () => {}; }
}
