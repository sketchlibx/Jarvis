import type { HandObservation } from "../../types/perception";
import { normalizeHandResult } from "../normalizeMediaPipeResults";

/**
 * Real MediaPipe Tasks Vision integration (`@mediapipe/tasks-vision`,
 * HandLandmarker) per spec section 10's explicit preference. This calls
 * the actual library's documented API — `HandLandmarker.createFromOptions`,
 * `detectForVideo` — and converts its real output into `HandObservation[]`
 * via `normalizeHandResult` (see `normalizeMediaPipeResults.ts`), which
 * validates every landmark and drops incomplete/malformed hands rather than
 * fabricating or padding data. It does NOT fabricate landmark coordinates.
 *
 * ⚠️ Verification status: written correctly against the library's
 * documented API, but I could not install `@mediapipe/tasks-vision` or
 * download its WASM/model assets in this sandbox (no network — see
 * SETUP.md), so `detectForVideo`'s actual raw output shape is UNTESTED
 * against a real camera feed. The normalization layer downstream of it
 * (`normalizeMediaPipeResults.ts`) IS logic-tested against realistic and
 * malformed synthetic data — see its test file.
 */
export class MediaPipeHandsProvider {
  private landmarker: any | null = null; // HandLandmarker instance, typed `any` to avoid a hard npm dependency at type-check time
  private lastFrameTimeMs = 0;

  /**
   * @param wasmBasePath Path to the MediaPipe WASM assets, typically served
   * from `/node_modules/@mediapipe/tasks-vision/wasm` via a static copy step,
   * or a CDN URL during development.
   * @param modelAssetPath Path to the `hand_landmarker.task` model file —
   * must be downloaded separately (see SETUP.md), not bundled here.
   */
  async initialize(wasmBasePath: string, modelAssetPath: string): Promise<void> {
    // Dynamic import so this module doesn't hard-fail to load in
    // environments where the package isn't installed yet — the caller
    // gets a clear error only when they actually try to use hand tracking.
    const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmBasePath);
    this.landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2, // spec: "up to 2 hands"
    });
  }

  /**
   * Runs detection on a single video frame. Caller (VisionPipeline's frame
   * loop, throttled per spec section 31's FPS guidance) supplies the frame;
   * this does not manage its own capture loop.
   */
  detect(video: HTMLVideoElement, timestampMs: number): HandObservation[] {
    if (!this.landmarker) {
      throw new Error("MediaPipeHandsProvider.initialize() must be called and awaited before detect().");
    }
    // MediaPipe requires monotonically increasing timestamps for VIDEO mode.
    if (timestampMs <= this.lastFrameTimeMs) return [];
    this.lastFrameTimeMs = timestampMs;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    return normalizeHandResult(result, new Date().toISOString());
  }

  close(): void {
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  get isInitialized(): boolean {
    return this.landmarker !== null;
  }
}
