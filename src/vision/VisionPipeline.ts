import type {
  FaceObservation, GestureObservation, HandObservation, PerceptionSnapshot,
  PoseObservation, VisionPipelineStats,
} from "../types/perception";
import type { PerceptionEventBus } from "../perception/EventBus";
import type { GestureEngine } from "../perception/GestureEngine";
import type { PerceptionContext } from "../perception/PerceptionContext";

/** Minimal surface every MediaPipe*Provider exposes — used so
 * VisionPipeline depends on an interface, not concrete classes, which is
 * what makes it possible to inject fakes in tests without a real browser
 * or the `@mediapipe/tasks-vision` package installed. */
interface FrameDetector<TResult> {
  readonly isInitialized: boolean;
  detect(video: HTMLVideoElement, timestampMs: number): TResult;
}

/** Minimal video-like surface the pipeline actually touches — lets tests
 * supply a plain object instead of a real HTMLVideoElement. */
interface VideoLike {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
}

export interface VisionPipelineOptions {
  enableHands: boolean;
  enableFace: boolean;
  enablePose: boolean;
  /** Target detector FPS — a ceiling, not a guarantee (spec section 27,
   * 31: "configurable vision FPS", "avoid unnecessary AI API calls"). */
  targetFps: number;
  /**
   * Injectable ONLY for tests, where no real video element/rVFC/rAF exists.
   * Leave undefined in real (browser) use — `start()` then picks
   * `requestVideoFrameCallback` when the attached video supports it
   * (frame-accurate, only fires on genuinely new frames) and falls back to
   * `requestAnimationFrame` otherwise, per spec section 5. This is resolved
   * per-call against the currently attached video, not fixed at
   * construction time, so it keeps working correctly across stop/reattach.
   */
  scheduleFrame?: (video: VideoLike | HTMLVideoElement | null, cb: (nowMs: number) => void) => number;
  cancelFrame?: (video: VideoLike | HTMLVideoElement | null, id: number) => void;
  onStreamEnded?: () => void;
}

const DEFAULT_OPTIONS: Omit<VisionPipelineOptions, "scheduleFrame" | "cancelFrame"> = {
  enableHands: true,
  enableFace: false, // off by default — heavier model, opt-in
  enablePose: false,
  targetFps: 15,
};

function hasRequestVideoFrameCallback(video: unknown): video is HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number, meta: unknown) => void) => number;
  cancelVideoFrameCallback: (id: number) => void;
} {
  return typeof video === "object" && video !== null && "requestVideoFrameCallback" in video;
}

/** Default scheduler: prefers requestVideoFrameCallback (only fires on
 * actual new decoded frames, so it can't out-race the camera) and falls
 * back to requestAnimationFrame for WebViews that don't support it yet. */
function defaultScheduleFrame(video: VideoLike | HTMLVideoElement | null, cb: (nowMs: number) => void): number {
  if (hasRequestVideoFrameCallback(video)) {
    return video.requestVideoFrameCallback((now) => cb(now));
  }
  return requestAnimationFrame(cb);
}
function defaultCancelFrame(video: VideoLike | HTMLVideoElement | null, id: number): void {
  if (hasRequestVideoFrameCallback(video)) {
    video.cancelVideoFrameCallback(id);
    return;
  }
  cancelAnimationFrame(id);
}

/**
 * Coordinates Camera → MediaPipe → structured observations → EventBus →
 * GestureEngine → PerceptionContext, per the spec's required pipeline.
 * Owns exactly one frame-processing loop at a time — `start()` is a no-op
 * if already running, and every scheduled callback checks a generation
 * counter against `this.generation` before doing any work, so a callback
 * scheduled by a previous `start()` can never execute after a `stop()`
 * even if the underlying cancel call is somehow ineffective (defense in
 * depth against the "duplicate processing loop" failure mode spec section
 * 18/5 explicitly calls out).
 */
export class VisionPipeline {
  private options: VisionPipelineOptions;
  private video: VideoLike | HTMLVideoElement | null = null;
  private running = false;
  private generation = 0;
  private frameHandle: number | null = null;
  private activeCancel: ((video: VideoLike | HTMLVideoElement | null, id: number) => void) | null = null;

  // Transition tracking — events fire only on detected/lost transitions,
  // never once per frame (spec section 11/21: avoid publishing hundreds of
  // times per second, avoid duplicate events).
  private prevHandIds = new Set<string>();
  private prevFaceDetected = false;
  private prevPoseDetected = false;

  // FPS tracking — camera FPS (frame arrivals) vs vision FPS (detector
  // completions) are tracked SEPARATELY per spec section 16's explicit
  // instruction not to conflate render/frame-arrival rate with actual
  // model inference rate.
  private cameraFrameTimes: number[] = [];
  private visionFrameTimes: number[] = [];
  private statsListeners = new Set<(stats: VisionPipelineStats) => void>();

  constructor(
    private hands: FrameDetector<HandObservation[]> | null,
    private face: FrameDetector<FaceObservation> | null,
    private pose: FrameDetector<PoseObservation> | null,
    private gestureEngine: GestureEngine,
    private perceptionContext: PerceptionContext,
    private eventBus: PerceptionEventBus,
    options: Partial<VisionPipelineOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private snapshotListeners = new Set<(s: PerceptionSnapshot) => void>();
  onSnapshot(cb: (s: PerceptionSnapshot) => void): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }
  onStats(cb: (stats: VisionPipelineStats) => void): () => void {
    this.statsListeners.add(cb);
    return () => this.statsListeners.delete(cb);
  }

  /**
   * Attaches a real camera stream. Waits for valid video dimensions before
   * the frame loop can meaningfully run (spec section 4: "wait until the
   * video has valid dimensions"). Does NOT start the loop — call start()
   * separately, so a caller can attach without immediately processing.
   */
  async attachStream(stream: MediaStream, videoEl: HTMLVideoElement): Promise<void> {
    videoEl.srcObject = stream;
    videoEl.muted = true;
    await videoEl.play().catch(() => {}); // autoplay rejection is non-fatal; frames just won't arrive yet

    await waitForValidDimensions(videoEl);
    this.video = videoEl;

    const track = stream.getVideoTracks()[0];
    track?.addEventListener("ended", () => {
      this.stop();
      this.options.onStreamEnded?.();
    });
  }

  /**
   * No-op if already running — this is the primary duplicate-loop guard.
   * NOTE: after `stop()`, `attachStream()` must be called again before
   * `start()` will do anything (stop() clears the video reference — see
   * its doc comment). This matches real usage: `CameraProvider.start()`
   * issues a brand new `MediaStream` each time, so reusing a stale video
   * reference across a stop/restart cycle would risk processing a dead
   * stream.
   */
  start(): void {
    if (this.running || !this.video) return;
    this.running = true;
    this.generation += 1;
    const myGeneration = this.generation;
    this.cameraFrameTimes = [];
    this.visionFrameTimes = [];

    const schedule = this.options.scheduleFrame ?? defaultScheduleFrame;
    const cancel = this.options.cancelFrame ?? defaultCancelFrame;
    this.activeCancel = cancel;

    const minFrameIntervalMs = 1000 / this.options.targetFps;
    let lastProcessedMs = -Infinity; // ensures the very first frame is always processed regardless of its timestamp value

    const loop = (nowMs: number) => {
      // Stale-callback guard: if stop()/start() ran again since this
      // callback was scheduled, this generation no longer matches — do
      // nothing. This is what makes camera restart safe even if a
      // previously-scheduled frame callback fires late.
      if (myGeneration !== this.generation || !this.running) return;

      this.recordCameraFrame(nowMs);

      if (nowMs - lastProcessedMs >= minFrameIntervalMs) {
        lastProcessedMs = nowMs;
        this.processFrame(nowMs);
      }

      this.frameHandle = schedule(this.video, loop);
    };

    this.frameHandle = schedule(this.video, loop);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1; // invalidates any in-flight scheduled callback
    if (this.frameHandle !== null && this.activeCancel) {
      this.activeCancel(this.video, this.frameHandle);
      this.frameHandle = null;
    }
    // Cleared deliberately — see start()'s doc comment. A caller must
    // attachStream() a fresh MediaStream before starting again.
    this.video = null;
    this.prevHandIds.clear();
    this.prevFaceDetected = false;
    this.prevPoseDetected = false;
  }

  /** Full teardown — releases MediaPipe model resources. Call on app
   * unmount, not on ordinary camera stop (models are expensive to reload,
   * so an ordinary stop/restart cycle keeps them loaded — see spec section
   * 17 "avoid duplicate model instances" balanced against "recover after
   * camera restart"). */
  dispose(): void {
    this.stop();
    (this.hands as any)?.close?.();
    (this.face as any)?.close?.();
    (this.pose as any)?.close?.();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private processFrame(nowMs: number): void {
    if (!this.video) return;
    const video = this.video as HTMLVideoElement;
    const timestamp = new Date().toISOString();
    let anyDetectorRan = false;

    let handObservations: HandObservation[] = [];
    if (this.options.enableHands && this.hands?.isInitialized) {
      try {
        handObservations = this.hands.detect(video, nowMs);
        anyDetectorRan = true;
      } catch {
        // Detector not ready or a transient decode error — skip this
        // frame's hand data rather than crashing the loop.
      }
    }

    let faceObservation: FaceObservation | null = null;
    if (this.options.enableFace && this.face?.isInitialized) {
      try {
        faceObservation = this.face.detect(video, nowMs);
        anyDetectorRan = true;
      } catch {
        /* see above */
      }
    }

    let poseObservation: PoseObservation | null = null;
    if (this.options.enablePose && this.pose?.isInitialized) {
      try {
        poseObservation = this.pose.detect(video, nowMs);
        anyDetectorRan = true;
      } catch {
        /* see above */
      }
    }

    if (anyDetectorRan) this.recordVisionFrame(nowMs);

    // Gesture classification — real landmarks in, real geometry out.
    const gestures: GestureObservation[] = handObservations.map((hand) => {
      const { gesture, confidence } = this.gestureEngine.classify(hand);
      return { gesture, confidence, handId: hand.id, timestamp };
    });

    // Update the shared PerceptionContext (existing interface, not a
    // parallel structure) so voice commands like "delete that" can resolve
    // targets from this frame's data.
    this.perceptionContext.updateHands(handObservations);
    this.perceptionContext.updateGesture(gestures[0] ?? null);
    this.perceptionContext.updateFacePresence(faceObservation?.detected ?? false);

    this.publishTransitionEvents(handObservations, faceObservation, poseObservation, gestures, timestamp);

    const snapshot: PerceptionSnapshot = {
      timestamp, hands: handObservations, face: faceObservation, pose: poseObservation, gestures,
    };
    this.snapshotListeners.forEach((cb) => cb(snapshot));
    this.emitStats();
  }

  private publishTransitionEvents(
    hands: HandObservation[], face: FaceObservation | null, pose: PoseObservation | null,
    gestures: GestureObservation[], timestamp: string
  ): void {
    const currentHandIds = new Set(hands.map((h) => h.id));
    for (const id of currentHandIds) {
      if (!this.prevHandIds.has(id)) {
        const hand = hands.find((h) => h.id === id)!;
        this.eventBus.emit({ type: "hand.detected", timestamp, confidence: hand.confidence, source: "vision", payload: hand }, id);
      }
    }
    for (const id of this.prevHandIds) {
      if (!currentHandIds.has(id)) {
        this.eventBus.emit({ type: "hand.lost", timestamp, confidence: 0, source: "vision", payload: { id } }, id);
      }
    }
    this.prevHandIds = currentHandIds;

    const faceDetected = face?.detected ?? false;
    if (faceDetected && !this.prevFaceDetected) {
      this.eventBus.emit({ type: "face.detected", timestamp, confidence: face!.confidence, source: "face", payload: face }, "face");
    } else if (!faceDetected && this.prevFaceDetected) {
      this.eventBus.emit({ type: "face.lost", timestamp, confidence: 0, source: "face", payload: null }, "face");
    }
    this.prevFaceDetected = faceDetected;

    const poseDetected = pose?.detected ?? false;
    if (poseDetected && !this.prevPoseDetected) {
      this.eventBus.emit({ type: "pose.detected", timestamp, confidence: pose!.confidence, source: "pose", payload: pose }, "pose");
    } else if (!poseDetected && this.prevPoseDetected) {
      this.eventBus.emit({ type: "pose.lost", timestamp, confidence: 0, source: "pose", payload: null }, "pose");
    }
    this.prevPoseDetected = poseDetected;

    for (const g of gestures) {
      if (g.gesture !== "none") {
        // Dedup key includes the gesture label so a genuinely CHANGED
        // gesture (fist -> open_hand) isn't throttled against the
        // previous, different gesture's timestamp.
        this.eventBus.emit({ type: "gesture.detected", timestamp, confidence: g.confidence, source: "gesture", payload: g }, `${g.handId}:${g.gesture}`);
      }
    }
  }

  private recordCameraFrame(nowMs: number): void {
    this.cameraFrameTimes.push(nowMs);
    this.cameraFrameTimes = this.cameraFrameTimes.filter((t) => nowMs - t < 1000);
  }
  private recordVisionFrame(nowMs: number): void {
    this.visionFrameTimes.push(nowMs);
    this.visionFrameTimes = this.visionFrameTimes.filter((t) => nowMs - t < 1000);
  }
  private emitStats(): void {
    const stats: VisionPipelineStats = {
      cameraFps: this.cameraFrameTimes.length,
      visionFps: this.visionFrameTimes.length,
      handsInitialized: this.hands?.isInitialized ?? false,
      faceInitialized: this.face?.isInitialized ?? false,
      poseInitialized: this.pose?.isInitialized ?? false,
    };
    this.statsListeners.forEach((cb) => cb(stats));
  }
}

/** Polls readyState/videoWidth rather than assuming 'loadedmetadata' always
 * fires before this is called (it may have already fired). Times out
 * rather than hanging forever if the stream never produces valid frames. */
function waitForValidDimensions(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Camera stream did not produce valid video dimensions within timeout."));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}
