declare module "kokoro-js" {
  export interface KokoroRawAudio {
    readonly data: Float32Array;
    readonly sampling_rate: number;
    toBlob(): Blob;
    save(path: string): Promise<void>;
  }

  export interface KokoroGenerateOptions {
    voice?: string;
    speed?: number;
  }

  export interface KokoroFromPretrainedOptions {
    dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
    device?: "wasm" | "webgpu" | "cpu" | null;
    progress_callback?: (progress: unknown) => void;
  }

  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: KokoroFromPretrainedOptions,
    ): Promise<KokoroTTS>;

    generate(text: string, options?: KokoroGenerateOptions): Promise<KokoroRawAudio>;
    list_voices(): void;
    readonly voices: Record<string, unknown>;
  }

  export const env: {
    cacheDir: string;
    wasmPaths: string;
  };
}
