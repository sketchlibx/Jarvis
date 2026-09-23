import { invoke } from "@tauri-apps/api/core";
import type { SpeakStatus, TextToSpeechProvider } from "../../types/voice";

export interface ElevenLabsTTSConfig {
  voiceId: string;
  modelId?: "eleven_flash_v2_5" | "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_v3" | "eleven_v4";
  volume?: number;
}

/**
 * Real ElevenLabs TTS adapter.
 *
 * The API key never crosses the frontend boundary: the Tauri command reads it
 * from the OS keychain and returns only the generated audio bytes.
 *
 * Playback deliberately uses Web Audio instead of `new Audio(blobUrl)`.
 * The old blob/media-element path was fragile in a Tauri WebView because the
 * app's CSP did not permit blob media and because the asynchronous API call
 * could happen after the browser's user-activation window. A single reusable
 * AudioContext is primed/resumed at the start of speak(), then the MP3 bytes
 * are decoded directly from an ArrayBuffer.
 */
export class ElevenLabsTTSProvider implements TextToSpeechProvider {
  readonly providerName = "elevenlabs-tts";
  private listeners = new Set<(status: SpeakStatus) => void>();
  private config: ElevenLabsTTSConfig;
  private audioContext: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private playbackGeneration = 0;

  constructor(config: ElevenLabsTTSConfig) {
    if (!config.voiceId.trim()) throw new Error("ElevenLabs voice ID is required.");
    this.config = { modelId: "eleven_flash_v2_5", volume: 1, ...config };
  }

  updateConfig(config: {
    volume?: number;
    voiceId?: string;
    modelId?: ElevenLabsTTSConfig["modelId"];
  }): void {
    if (typeof config.volume === "number") {
      this.config.volume = Math.max(0, Math.min(1, config.volume));
    }
    if (config.voiceId?.trim()) this.config.voiceId = config.voiceId.trim();
    if (config.modelId) this.config.modelId = config.modelId;
  }

  /**
   * Prime/resume the shared audio context. Calling this from the Settings
   * Test button keeps the resume request inside the user's gesture, while
   * speak() also calls it for normal app speech.
   */
  async preparePlayback(): Promise<void> {
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    if (context.state !== "running") {
      throw new Error(`ElevenLabs audio context is not running (state: ${context.state}).`);
    }
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

  async speak(text: string, signal?: AbortSignal): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.stop();
    const generation = this.playbackGeneration;
    this.setStatus("speaking");

    try {
      // Start/resume the audio context BEFORE the first await. This is
      // important for WebView autoplay/user-activation rules.
      const context = this.getAudioContext();
      const resumePromise = context.state === "suspended" ? context.resume() : Promise.resolve();

      // Tauri's IPC maps invoke() args by the Rust command's PARAMETER
      // NAME, not by the target struct's field names. `elevenlabs_tts`'s
      // signature is `elevenlabs_tts(req: ElevenLabsTtsRequest)` — a
      // single parameter literally named `req` — so the payload must be
      // wrapped as `{ req: {...} }`. Sending the three fields flat (no
      // `req` wrapper) is exactly what produced the real runtime error:
      // "invalid args `req` for command `elevenlabs_tts`: command
      // elevenlabs_tts missing required key req". The inner field names
      // (`voiceId`/`modelId`) still have to match `ElevenLabsTtsRequest`'s
      // `#[serde(rename = "voiceId"/"modelId")]` attributes exactly.
      const bytesPromise = invoke<number[]>("elevenlabs_tts", {
        req: {
          text: trimmed,
          voiceId: this.config.voiceId,
          modelId: this.config.modelId ?? "eleven_flash_v2_5",
        },
      });

      const [bytes] = await Promise.all([bytesPromise, resumePromise]);
      if (signal?.aborted || generation !== this.playbackGeneration) return;

      if (!Array.isArray(bytes) || bytes.length === 0) {
        throw new Error("ElevenLabs returned an empty audio response.");
      }

      if (context.state !== "running") {
        throw new Error(`ElevenLabs audio context is not running (state: ${context.state}).`);
      }

      // Copy the Tauri number[] into a standalone ArrayBuffer. This avoids
      // SharedArrayBuffer / Uint8Array typing differences across TS lib sets.
      const audioBuffer = new ArrayBuffer(bytes.length);
      new Uint8Array(audioBuffer).set(bytes.map((value) => value & 0xff));

      let decoded: AudioBuffer;
      try {
        decoded = await context.decodeAudioData(audioBuffer);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`ElevenLabs audio decode failed: ${detail}`);
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
      // An overlapping speak() call supersedes this generation. Never clean
      // up or change status for the newer playback from the old request.
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

  private cleanupPlaybackNodes(): void {
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.source = null;
    this.gainNode = null;
  }
}
