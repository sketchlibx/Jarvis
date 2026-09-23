import type { SpeakStatus, TextToSpeechProvider } from "../../types/voice";
import type { KokoroTTS as KokoroTTSModel } from "kokoro-js";

export interface KokoroTTSConfig {
  voice: string;
  speed?: number;
  volume?: number;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Phase 2 root-cause fix: neither the model download (first-run fetch
 * from Hugging Face, ~92MB) nor `tts.generate()` had any timeout. A
 * stalled/blocked network request (flaky connection, DNS/firewall issue
 * reaching huggingface.co) left this promise chain pending forever —
 * `speak()` never reached its own `finally`, so `setStatus("idle")` never
 * fired and the app was stuck in SPEAKING (and, upstream, THINKING/
 * SPEAKING in the state machine) with no recovery short of a restart.
 * This mirrors the same AbortController+timeout pattern already applied
 * to the AI provider calls, rather than inventing a second mechanism. */
const DEFAULT_TIMEOUT_MS = 45_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(handle); resolve(value); },
      (error) => { clearTimeout(handle); reject(error); }
    );
  });
}

/**
 * Real local Kokoro TTS adapter.
 *
 * Kokoro runs inside the app's WebView using ONNX Runtime through kokoro-js.
 * The q8 model is downloaded from Hugging Face on first use and then cached
 * locally by Transformers.js; synthesis itself does not call a paid TTS API
 * and does not require an API key.
 *
 * The model is intentionally lazy-loaded so the app startup path stays fast.
 * Playback uses the same Web Audio strategy as the ElevenLabs adapter: the
 * AudioContext is resumed before the first await, generated WAV bytes are
 * decoded directly, and no `new Audio(blobUrl)` autoplay path is used.
 */
export class KokoroTTSProvider implements TextToSpeechProvider {
  readonly providerName = "kokoro-local-tts";
  private listeners = new Set<(status: SpeakStatus) => void>();
  private config: KokoroTTSConfig;
  private model: KokoroTTSModel | null = null;
  private modelPromise: Promise<KokoroTTSModel> | null = null;
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private playbackGeneration = 0;

  constructor(config: KokoroTTSConfig = { voice: "am_michael", speed: 1, volume: 1 }) {
    this.config = { speed: 1, volume: 1, ...config };
  }

  updateConfig(config: { volume?: number; voice?: string; speed?: number }): void {
    if (typeof config.volume === "number") {
      this.config.volume = Math.max(0, Math.min(1, config.volume));
    }
    if (typeof config.speed === "number" && Number.isFinite(config.speed)) {
      this.config.speed = Math.max(0.5, Math.min(2, config.speed));
    }
    if (config.voice?.trim()) this.config.voice = config.voice.trim();
  }

  onStatusChange(cb: (status: SpeakStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(status: SpeakStatus): void {
    this.listeners.forEach((cb) => cb(status));
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Web Audio API is not available in this WebView.");
      }
      this.audioContext = new AudioContextCtor();
    }
    return this.audioContext;
  }

  private async ensureModel(signal?: AbortSignal): Promise<KokoroTTSModel> {
    if (this.model) return this.model;
    if (signal?.aborted) throw new DOMException("Kokoro TTS request was cancelled.", "AbortError");
    if (!this.modelPromise) {
      // IMPORTANT: keep kokoro-js out of the module-evaluation path. The
      // package pulls in ONNX Runtime/WASM machinery; eagerly importing it
      // makes unrelated Vitest/jsdom suites load a native worker runtime and
      // can terminate a test worker before any test actually uses Kokoro.
      // The real TTS runtime is loaded only when Kokoro is explicitly used.
      this.modelPromise = import("kokoro-js").then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL_ID, {
        // q8 is the compatibility-first local build; the current v1.0 ONNX
        // model lists this quantization at about 92.4 MB. WebGPU/fp32 is an
        // optional future performance mode, not a requirement for this pass.
        dtype: "q8",
        device: "wasm",
      })).then((tts) => {
        this.model = tts;
        return tts;
      }).finally(() => {
        this.modelPromise = null;
      });
    }
    const model = await this.modelPromise;
    if (signal?.aborted) throw new DOMException("Kokoro TTS request was cancelled.", "AbortError");
    return model;
  }

  /** Load the model ahead of the first spoken response without synthesizing. */
  async prepare(): Promise<void> {
    await withTimeout(
      this.ensureModel(),
      DEFAULT_TIMEOUT_MS,
      "Kokoro model download/initialization timed out. Check your network connection or try a different TTS provider in Settings."
    );
  }

  async speak(text: string, signal?: AbortSignal): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.stop();
    const generation = this.playbackGeneration;
    this.setStatus("speaking");

    try {
      // Prime/resume before any model download/inference await.
      const context = this.getAudioContext();
      const resumePromise = context.state === "suspended" ? context.resume() : Promise.resolve();
      const modelPromise = this.ensureModel(signal);
      const [tts] = await withTimeout(
        Promise.all([modelPromise, resumePromise]),
        DEFAULT_TIMEOUT_MS,
        "Kokoro model download/initialization timed out. Check your network connection or try a different TTS provider in Settings."
      );

      if (signal?.aborted || generation !== this.playbackGeneration) return;
      if (context.state !== "running") {
        throw new Error(`Kokoro audio context is not running (state: ${context.state}).`);
      }

      const audio = await withTimeout(
        tts.generate(trimmed, {
          voice: this.config.voice,
          speed: this.config.speed ?? 1,
        }),
        DEFAULT_TIMEOUT_MS,
        "Kokoro speech synthesis timed out."
      );

      if (signal?.aborted || generation !== this.playbackGeneration) return;

      const wavBlob = audio.toBlob();
      const wavBuffer = await wavBlob.arrayBuffer();
      if (signal?.aborted || generation !== this.playbackGeneration) return;

      let decoded: AudioBuffer;
      try {
        decoded = await context.decodeAudioData(wavBuffer);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Kokoro audio decode failed: ${detail}`);
      }

      if (signal?.aborted || generation !== this.playbackGeneration) return;

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = decoded;
      gain.gain.value = this.config.volume ?? 1;
      source.connect(gain);
      gain.connect(context.destination);
      this.source = source;
      this.gainNode = gain;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => {
          try { source.stop(); } catch { /* already stopped */ }
          finish();
        };

        source.onended = () => finish();
        signal?.addEventListener("abort", onAbort, { once: true });

        try {
          source.start(0);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } catch (error) {
      if (generation === this.playbackGeneration) this.setStatus("error");
      throw error;
    } finally {
      if (generation === this.playbackGeneration) {
        this.cleanupPlaybackNodes();
        this.setStatus("idle");
      }
    }
  }

  stop(): void {
    this.playbackGeneration += 1;
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
    }
    this.cleanupPlaybackNodes();
  }

  clearModel(): void {
    this.stop();
    this.model = null;
    this.modelPromise = null;
  }

  private cleanupPlaybackNodes(): void {
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.source = null;
    this.gainNode = null;
  }
}
