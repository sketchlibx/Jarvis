import type { FaceObservation, PoseObservation } from "../../types/perception";
import { normalizeFaceResult, normalizePoseResult } from "../normalizeMediaPipeResults";

/**
 * # Status: FOUNDATION — real API wiring, minimal feature extraction.
 *
 * Like MediaPipeHandsProvider, this calls the actual `@mediapipe/tasks-vision`
 * FaceLandmarker API and converts real output via `normalizeFaceResult`
 * (validated, never fabricated — see `normalizeMediaPipeResults.ts`). Per
 * spec section 12, this is explicitly scoped as a foundation: exactly two
 * raw geometric expression features (mouth-open ratio; brow-furrow proxy is
 * not yet computed — see note below) — not a full FACS-style feature set,
 * and never a named emotion. Emotion labeling happens only in
 * StateFusionEngine, downstream, with confidence attached.
 *
 * ⚠️ Same verification caveat as MediaPipeHandsProvider: written against
 * the documented API, not run against a real camera in this sandbox. The
 * normalization layer downstream IS logic-tested against synthetic data.
 */
export class MediaPipeFaceProvider {
  private landmarker: any | null = null;
  private lastFrameTimeMs = 0;

  async initialize(wasmBasePath: string, modelAssetPath: string): Promise<void> {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmBasePath);
    this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceObservation {
    if (!this.landmarker) {
      throw new Error("MediaPipeFaceProvider.initialize() must be called and awaited before detect().");
    }
    if (timestampMs <= this.lastFrameTimeMs) {
      return { detected: false, confidence: 0, landmarks: [], headPose: null, expressionFeatures: {}, timestamp: new Date().toISOString() };
    }
    this.lastFrameTimeMs = timestampMs;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    return normalizeFaceResult(result, new Date().toISOString());
  }

  close(): void {
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  get isInitialized(): boolean {
    return this.landmarker !== null;
  }
}

/**
 * # Status: FOUNDATION ONLY — narrower than hands/face.
 *
 * Extracts just the six upper-body landmarks the spec asks for (shoulders,
 * elbows, wrists) from MediaPipe's PoseLandmarker, via `normalizePoseResult`,
 * as a base for future AR work. Full-body pose is explicitly out of scope
 * for Phase 3.
 */
export class MediaPipePoseProvider {
  private landmarker: any | null = null;
  private lastFrameTimeMs = 0;

  async initialize(wasmBasePath: string, modelAssetPath: string): Promise<void> {
    const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmBasePath);
    this.landmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): PoseObservation {
    if (!this.landmarker) {
      throw new Error("MediaPipePoseProvider.initialize() must be called and awaited before detect().");
    }
    if (timestampMs <= this.lastFrameTimeMs) {
      return { detected: false, confidence: 0, landmarks: {}, timestamp: new Date().toISOString() };
    }
    this.lastFrameTimeMs = timestampMs;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    return normalizePoseResult(result, new Date().toISOString());
  }

  close(): void {
    this.landmarker?.close?.();
    this.landmarker = null;
  }

  get isInitialized(): boolean {
    return this.landmarker !== null;
  }
}
