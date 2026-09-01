import type { MicStatus, SpeakStatus, SpeechToTextProvider, TextToSpeechProvider, VoiceProvider } from "../../types/voice";

// Web Speech API types aren't in standard lib.dom.d.ts in all TS configs —
// declare the minimal surface we use rather than pulling in a whole types
// package for one browser API.
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

/**
 * Real Web Speech API implementation — this runs against the actual
 * SpeechRecognition/SpeechSynthesis APIs exposed by WebView2 (Chromium),
 * per SETUP.md's recommendation. Push-to-talk only: recording starts on
 * startListening() and stops on stopListening(), never continuously in the
 * background (spec section 7 privacy requirement).
 */
export class WebSpeechSTTProvider implements SpeechToTextProvider {
  readonly providerName = "web-speech-stt";
  private recognition: ISpeechRecognition | null = null;
  private statusListeners = new Set<(s: MicStatus) => void>();
  private status: MicStatus = "idle";
  private finalTranscript = "";
  private resolveStop: ((transcript: string) => void) | null = null;

  constructor(private lang = "en-US") {}

  private setStatus(s: MicStatus) {
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  /** Exposes the last known status synchronously, for callers that connect
   * after startListening() already fired (onStatusChange only notifies
   * future changes). */
  getStatus(): MicStatus {
    return this.status;
  }

  private available(): ISpeechRecognition | null {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return null;
    return new Ctor();
  }

  async startListening(): Promise<void> {
    const rec = this.available();
    if (!rec) {
      this.setStatus("unavailable");
      throw new Error("SpeechRecognition is not available in this WebView.");
    }

    // Explicit permission check via getUserMedia first, so denial is
    // reported accurately rather than surfacing as a vague recognition
    // error later.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // we only needed the permission prompt
    } catch {
      this.setStatus("permission_denied");
      throw new Error("Microphone permission was denied.");
    }

    this.recognition = rec;
    this.finalTranscript = "";
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;

    rec.onstart = () => this.setStatus("listening");
    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptPiece = event.results[i][0].transcript;
        if (event.results[i].isFinal) this.finalTranscript += transcriptPiece;
        else interim += transcriptPiece;
      }
    };
    rec.onerror = () => this.setStatus("error");
    rec.onend = () => {
      this.setStatus("idle");
      if (this.resolveStop) {
        this.resolveStop(this.finalTranscript.trim());
        this.resolveStop = null;
      }
    };

    rec.start();
  }

  async stopListening(): Promise<string> {
    if (!this.recognition) return "";
    this.setStatus("processing");
    return new Promise((resolve) => {
      this.resolveStop = resolve;
      this.recognition!.stop();
    });
  }

  abort(): void {
    this.recognition?.abort();
    this.recognition = null;
    this.setStatus("idle");
  }

  onStatusChange(cb: (status: MicStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}

/**
 * Real SpeechSynthesis (Web Speech API TTS). Supports interruption
 * (spec section 5/28) via speechSynthesis.cancel(). Uses an original
 * system voice — whichever the OS/browser exposes by default — never an
 * attempt to reproduce a specific copyrighted character's voice.
 */
export class WebSpeechTTSProvider implements TextToSpeechProvider {
  readonly providerName = "web-speech-tts";
  private statusListeners = new Set<(s: SpeakStatus) => void>();
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor(private config: { rate?: number; pitch?: number; volume?: number; voiceName?: string } = {}) {}

  private setStatus(s: SpeakStatus) {
    this.statusListeners.forEach((cb) => cb(s));
  }

  async speak(text: string, signal?: AbortSignal): Promise<void> {
    if (!("speechSynthesis" in window)) {
      this.setStatus("error");
      throw new Error("SpeechSynthesis is not available in this WebView.");
    }
    // Interruption: any previous utterance is cancelled before a new one
    // starts, and an external AbortSignal (e.g. wired to "Stop.") does the
    // same — this reuses the Phase 2 cancellation pattern rather than
    // inventing a second one, per spec section 5.
    window.speechSynthesis.cancel();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = this.config.rate ?? 1.0;
      utterance.pitch = this.config.pitch ?? 1.0;
      utterance.volume = this.config.volume ?? 1.0;
      if (this.config.voiceName) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.name === this.config.voiceName);
        if (voice) utterance.voice = voice;
      }

      const onAbort = () => {
        window.speechSynthesis.cancel();
      };
      signal?.addEventListener("abort", onAbort);

      utterance.onstart = () => this.setStatus("speaking");
      utterance.onend = () => {
        this.setStatus("idle");
        this.currentUtterance = null;
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      utterance.onerror = (e) => {
        this.setStatus("error");
        this.currentUtterance = null;
        signal?.removeEventListener("abort", onAbort);
        // "interrupted"/"canceled" are expected outcomes of Stop, not real errors.
        if (e.error === "interrupted" || e.error === "canceled") resolve();
        else reject(new Error(`TTS error: ${e.error}`));
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    window.speechSynthesis?.cancel();
    this.currentUtterance = null;
    this.setStatus("idle");
  }

  /** Exposes the utterance currently being spoken (or null), so a caller
   * can e.g. check text before deciding whether to interrupt. */
  getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }

  onStatusChange(cb: (status: SpeakStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}

export function createWebSpeechVoiceProvider(lang = "en-US"): VoiceProvider {
  return {
    stt: new WebSpeechSTTProvider(lang),
    tts: new WebSpeechTTSProvider(),
    // Wake word intentionally omitted — see SETUP.md "Wake word status".
  };
}
