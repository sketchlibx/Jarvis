import type { MicStatus, SpeakStatus, SpeechToTextProvider, TextToSpeechProvider, VoiceProvider } from "../../types/voice";
import { SpeechTranscriptWakeWordProvider } from "./WakeWordProvider";
import { ElevenLabsTTSProvider } from "./ElevenLabsTTSProvider";
import { KokoroTTSProvider } from "./KokoroTTSProvider";

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
 * per SETUP.md's recommendation. Push-to-talk/tap-to-toggle only:
 * recording starts on startListening() and can remain continuous when the
 * user's Settings explicitly enable automatic listening.
 *
 * ROOT-CAUSE FIX (this session): this class used to do an explicit
 * `await navigator.mediaDevices.getUserMedia(...)` purely as a permission
 * pre-check BEFORE calling `rec.start()`, then immediately discarded that
 * stream. That created two real bugs at once: (1) a genuine extra
 * getUserMedia acquisition per tap, on top of SpeechRecognition's own
 * internal mic access — a real "duplicate audio stream" — and (2) an
 * async gap between the user's tap and `rec.start()` actually running.
 * For a quick tap, the matching pointerup (see App.tsx's handleMicPointerUp)
 * could fire and call stopListening() BEFORE that pre-check even resolved,
 * so `this.recognition` was still null (or had JUST been assigned) when
 * `.stop()` was called — browsers routinely produce a completely empty
 * transcript when a recognizer is stopped that fast. This is the root
 * cause of "clicking the mic enables then immediately disables and often
 * captures no speech." Fixed by calling `rec.start()` directly and
 * relying on SpeechRecognition's OWN `onerror` (event.error ===
 * "not-allowed"/"service-not-allowed") for permission denial — which
 * Chromium/WebView2 (this app's one fixed, known target) reports
 * reliably — rather than a separate, redundant pre-flight check.
 */
export class WebSpeechSTTProvider implements SpeechToTextProvider {
  readonly providerName = "web-speech-stt";
  private recognition: ISpeechRecognition | null = null;
  private statusListeners = new Set<(s: MicStatus) => void>();
  private status: MicStatus = "idle";
  private finalTranscript = "";
  private resolveStop: ((transcript: string) => void) | null = null;
  private stopTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intentionalStop = false;
  private restartHandle: ReturnType<typeof setTimeout> | null = null;
  private transcriptListeners = new Set<(transcript: string) => void>();

  constructor(private lang = "en-US") {}

  private setStatus(s: MicStatus) {
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  /** Exposes the last known status synchronously, for callers that connect
   * after startListening() already fired (onStatusChange only notifies
   * future changes), AND for the re-entrancy guard below — reading this
   * directly avoids relying on React state, which lags a render behind
   * during a fast double-tap. */
  getStatus(): MicStatus {
    return this.status;
  }

  private available(): ISpeechRecognition | null {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return null;
    return new Ctor();
  }

  onFinalTranscript(cb: (transcript: string) => void): () => void {
    this.transcriptListeners.add(cb);
    return () => this.transcriptListeners.delete(cb);
  }

  async startListening(): Promise<void> {
    // Re-entrancy guard (spec: "avoid duplicate ... listeners"): without
    // this, two fast, overlapping calls (double-fired events, a fast
    // double-tap) would create a SECOND SpeechRecognition instance and
    // overwrite `this.recognition`, silently orphaning the first one —
    // its stream/listeners never get cleaned up because nothing holds a
    // reference to it anymore.
    if (this.status === "listening" || this.status === "starting") return;

    const rec = this.available();
    if (!rec) {
      this.setStatus("unavailable");
      throw new Error("SpeechRecognition is not available in this WebView.");
    }

    this.setStatus("starting");
    this.intentionalStop = false;
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
        if (event.results[i].isFinal) {
          this.finalTranscript += transcriptPiece;
          const finalText = transcriptPiece.trim();
          if (finalText) this.transcriptListeners.forEach((cb) => cb(finalText));
        } else interim += transcriptPiece;
      }
    };
    rec.onerror = (event: any) => {
      const code = event?.error;
      // Mapped from the recognizer's OWN error, now that the separate
      // getUserMedia pre-check (which used to produce this signal
      // instead) is gone.
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.setStatus("permission_denied");
      } else if (code === "no-speech") {
        // A genuinely empty utterance (tap too quiet/short) is an
        // expected outcome, not a hard error the user needs an error
        // state for — onend below still resolves stopListening() with
        // whatever (empty) transcript was captured.
        this.setStatus("idle");
      } else if (code === "aborted") {
        // Our own abort()/rapid restart calls this — not a real failure.
        this.setStatus("idle");
      } else {
        this.setStatus("error");
      }
    };
    rec.onend = () => {
      if (this.stopTimeoutHandle !== null) {
        clearTimeout(this.stopTimeoutHandle);
        this.stopTimeoutHandle = null;
      }

      // Chromium/WebView can end a continuous recognizer by itself after a
      // silence/network boundary. JARVIS should remain in the user-selected
      // listening mode instead of silently switching itself off.
      if (!this.intentionalStop && this.status !== "permission_denied" && this.status !== "error") {
        this.setStatus("starting");
        this.restartHandle = setTimeout(() => {
          this.restartHandle = null;
          if (this.intentionalStop || this.recognition !== rec) return;
          try { rec.start(); } catch {
            // Some Chromium builds throw if restart races the previous end.
            // The next end/error path will surface a real failure if it persists.
          }
        }, 120);
        return;
      }

      if (this.status === "listening" || this.status === "starting" || this.status === "processing") {
        this.setStatus("idle");
      }
      if (this.resolveStop) {
        this.resolveStop(this.finalTranscript.trim());
        this.resolveStop = null;
      }
      this.recognition = null;
    };

    rec.start(); // synchronous — no more redundant pre-flight getUserMedia() in front of this
  }

  async stopListening(): Promise<string> {
    if (!this.recognition) return "";
    this.intentionalStop = true;
    if (this.restartHandle !== null) { clearTimeout(this.restartHandle); this.restartHandle = null; }
    this.setStatus("processing");
    return new Promise((resolve) => {
      this.resolveStop = resolve;
      try {
        this.recognition!.stop();
      } catch {
        // Some engines throw if stop() is called in certain transitional
        // states (e.g. right after start(), before it's fully spun up) —
        // abort() is the safe fallback and still triggers onend.
        try { this.recognition!.abort(); } catch { /* already gone */ }
      }
      // Safety net (spec: handle "timeout" correctly) — if onend never
      // fires for any reason, this Promise would otherwise hang forever
      // and the whole push-to-talk button would appear permanently stuck
      // in "processing". Forces resolution with whatever was captured and
      // hard-resets state.
      this.stopTimeoutHandle = setTimeout(() => {
        if (this.resolveStop) {
          this.resolveStop(this.finalTranscript.trim());
          this.resolveStop = null;
          this.setStatus("idle");
          this.recognition = null;
        }
      }, 4000);
    });
  }

  abort(): void {
    if (this.stopTimeoutHandle !== null) {
      clearTimeout(this.stopTimeoutHandle);
      this.stopTimeoutHandle = null;
    }
    this.recognition?.abort();
    this.recognition = null;
    this.resolveStop = null;
    this.setStatus("idle");
  }

  onStatusChange(cb: (status: MicStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}

/**
 * Real SpeechSynthesis (Web Speech API TTS). Supports interruption
 * (spec section 5/28) via speechSynthesis.cancel(). Uses a REAL system
 * voice already installed in Windows/WebView2 — never an attempt to
 * reproduce a specific copyrighted character's or real person's voice,
 * and never a fabricated/synthesized-elsewhere audio file.
 *
 * Voice-quality pass (this session): previously always used
 * SpeechSynthesisUtterance's bare defaults (rate/pitch/volume all 1.0,
 * whatever voice the WebView happened to default to) — Settings'
 * voice/speechSpeed fields existed but were never actually passed to this
 * class at all (createWebSpeechVoiceProvider() was called with zero
 * config in App.tsx). Fixed via updateConfig() below, called from a real
 * settings-change effect. Also adds pickBestVoice(): when the user hasn't
 * explicitly chosen a voice, this scores the REAL voices
 * window.speechSynthesis.getVoices() actually returns on this machine and
 * prefers Windows' higher-quality "Natural"/"Online" neural voices when
 * installed — still just selecting among real, already-installed system
 * voices, never downloading, faking, or cloning one.
 */
function getVoicesSafe(): SpeechSynthesisVoice[] {
  return "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
}

/** Chromium/WebView2 famously returns an EMPTY array from getVoices() on
 * the very first call after the page loads, populating it asynchronously
 * once the OS voice list is actually read — a well-known real Web Speech
 * API quirk, not a hypothetical. Without handling this, pickBestVoice()
 * would silently always fall through to "no preference" on a cold start. */
export function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const existing = getVoicesSafe();
  if (existing.length > 0) return Promise.resolve(existing);
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(getVoicesSafe());
    };
    const timer = setTimeout(done, timeoutMs);
    window.speechSynthesis.addEventListener("voiceschanged", done);
  });
}

/** Scores REAL, already-installed voices by name patterns Windows/Edge
 * actually uses for its higher-quality neural voices — "Natural" (Windows
 * 10/11's on-device neural voices) and "Online" (server-assisted neural
 * voices) — over the older, more robotic SAPI5 default voices. This is a
 * heuristic over real data, not a guarantee: exact availability depends on
 * what the user has installed via Windows Settings > Time & Language >
 * Speech, which this app has no way to alter. Falls back gracefully
 * through each tier rather than assuming any of them exist. */
export function pickBestVoice(voices: SpeechSynthesisVoice[], preferredLang = "en"): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const langMatches = voices.filter((v) => v.lang.toLowerCase().startsWith(preferredLang));
  const pool = langMatches.length > 0 ? langMatches : voices;

  const score = (v: SpeechSynthesisVoice): number => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (n.includes("natural")) s += 30; // Windows on-device neural voices
    if (n.includes("online")) s += 20; // Windows server-assisted neural voices
    if (n.includes("neural")) s += 20;
    if (v.localService) s += 2; // slight preference for no network round-trip per utterance
    return s;
  };

  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

export class WebSpeechTTSProvider implements TextToSpeechProvider {
  readonly providerName = "web-speech-tts";
  private statusListeners = new Set<(s: SpeakStatus) => void>();
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private resolvedVoice: SpeechSynthesisVoice | null = null;
  private elevenLabs: ElevenLabsTTSProvider | null = null;
  private kokoro: KokoroTTSProvider | null = null;
  private activeTtsProvider: "web_speech" | "elevenlabs" | "kokoro" = "web_speech";

  constructor(private config: { rate?: number; pitch?: number; volume?: number; voiceName?: string } = {}) {}

  /** Applies new rate/pitch/volume/voiceName WITHOUT recreating the
   * provider (which would drop in-flight status listeners for no reason)
   * — called whenever Settings' Voice tab changes, and once at startup
   * once real settings have loaded. Takes effect on the NEXT speak() call;
   * does not affect an utterance already in progress (SpeechSynthesis
   * doesn't support changing a live utterance's parameters mid-speech). */
  updateConfig(config: { rate?: number; pitch?: number; volume?: number; voiceName?: string }): void {
    this.config = { ...this.config, ...config };
    this.kokoro?.updateConfig({
      speed: this.config.rate,
      volume: this.config.volume,
    });
  }

  /** Configure the real ElevenLabs backend without replacing this provider
   * object, so existing App.tsx status listeners remain attached. */
  configureElevenLabs(config: { voiceId: string; modelId?: "eleven_flash_v2_5" | "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_v3" | "eleven_v4" }): void {
    this.elevenLabs = new ElevenLabsTTSProvider({ voiceId: config.voiceId, modelId: config.modelId });
  }

  configureKokoro(config: { voice: string }): void {
    if (!this.kokoro) {
      this.kokoro = new KokoroTTSProvider({ voice: config.voice, speed: this.config.rate ?? 1, volume: this.config.volume ?? 1 });
    } else {
      this.kokoro.updateConfig({ voice: config.voice, speed: this.config.rate ?? 1, volume: this.config.volume ?? 1 });
    }
  }

  clearKokoro(): void {
    this.kokoro?.clearModel();
    this.kokoro = null;
  }

  updateKokoroVoice(voice: string): void {
    this.kokoro?.updateConfig({ voice });
  }

  async prepareKokoro(): Promise<void> {
    await this.kokoro?.prepare();
  }

  setTTSProvider(provider: "web_speech" | "elevenlabs" | "kokoro"): void {
    if (this.activeTtsProvider === provider) return;
    this.elevenLabs?.stop();
    this.kokoro?.stop();
    window.speechSynthesis?.cancel();
    this.activeTtsProvider = provider;
  }

  clearElevenLabs(): void {
    this.elevenLabs?.stop();
    this.elevenLabs = null;
  }

  async prepareElevenLabsPlayback(): Promise<void> {
    if (!this.elevenLabs) return;
    await this.elevenLabs.preparePlayback();
  }

  updateElevenLabsVoice(voiceId: string, modelId: string): void {
    this.elevenLabs?.updateConfig({ voiceId, modelId: modelId as "eleven_flash_v2_5" | "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_v3" | "eleven_v4" });
  }

  /** Real, already-installed voices this machine's WebView actually
   * exposes — for Settings' voice picker. Never a hardcoded list. */
  async listAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    return waitForVoices();
  }

  private setStatus(s: SpeakStatus) {
    this.statusListeners.forEach((cb) => cb(s));
  }

  async speak(text: string, signal?: AbortSignal): Promise<void> {
    if (this.activeTtsProvider === "kokoro") {
      if (!this.kokoro) {
        throw new Error("Kokoro Local TTS is not configured. Select a Kokoro voice in Settings.");
      }
      this.setStatus("speaking");
      try {
        await this.kokoro.speak(text, signal);
      } catch (error) {
        this.setStatus("error");
        throw error;
      } finally {
        this.setStatus("idle");
      }
      return;
    }
    if (this.activeTtsProvider === "elevenlabs") {
      if (!this.elevenLabs) {
        throw new Error("ElevenLabs TTS is selected but is not configured. Use Kokoro Local for payment-free TTS.");
      }
      this.setStatus("speaking");
      try {
        await this.elevenLabs.speak(text, signal);
      } catch (error) {
        this.setStatus("error");
        throw error;
      } finally {
        this.setStatus("idle");
      }
      return;
    }
    if (!("speechSynthesis" in window)) {
      this.setStatus("error");
      throw new Error("SpeechSynthesis is not available in this WebView.");
    }
    // Interruption: any previous utterance is cancelled before a new one
    // starts, and an external AbortSignal (e.g. wired to "Stop.") does the
    // same — this reuses the Phase 2 cancellation pattern rather than
    // inventing a second one, per spec section 5.
    window.speechSynthesis.cancel();

    // Resolve the actual voice to speak with, once per config change
    // rather than once per utterance — getVoices() is cheap once
    // populated, but re-resolving needlessly on every single sentence
    // adds nothing.
    if (!this.resolvedVoice || this.resolvedVoice.name !== this.config.voiceName) {
      const voices = await waitForVoices();
      this.resolvedVoice = this.config.voiceName
        ? voices.find((v) => v.name === this.config.voiceName) ?? pickBestVoice(voices)
        : pickBestVoice(voices);
    }

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      // Slightly calmer defaults than the raw API's 1.0/1.0/1.0 — a real,
      // audible pacing/tone difference from a generic flat robotic
      // reading, achieved purely through real SpeechSynthesisUtterance
      // parameters (never a fabricated audio effect).
      utterance.rate = this.config.rate ?? 1.0;
      utterance.pitch = this.config.pitch ?? 0.95;
      utterance.volume = this.config.volume ?? 1.0;
      if (this.resolvedVoice) utterance.voice = this.resolvedVoice;

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
    this.elevenLabs?.stop();
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

export function createWebSpeechVoiceProvider(
  lang = "en-US",
  ttsConfig: { rate?: number; pitch?: number; volume?: number; voiceName?: string } = {}
): VoiceProvider {
  const stt = new WebSpeechSTTProvider(lang);
  return {
    stt,
    tts: new WebSpeechTTSProvider(ttsConfig),
    // Same-recognizer wake-word fallback — no duplicate microphone stream.
    wakeWord: new SpeechTranscriptWakeWordProvider(stt),
  };
}
