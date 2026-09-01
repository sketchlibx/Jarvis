import type { FaceObservation, HandObservation, Handedness, PoseObservation } from "../types/perception";
import type { Anchor, AnchorType, Quaternion, TrackingState } from "./types";
import { IDENTITY_QUATERNION } from "./types";
import { CoordinateMapper } from "./CoordinateMapper";
import { estimateHandOrientation } from "./HandOrientation";
import { ExponentialSmoother, QuaternionSmoother } from "./Smoothing";

interface TrackedAnchorState {
  anchor: Anchor;
  positionSmoother: ExponentialSmoother;
  rotationSmoother: QuaternionSmoother;
  lastSeenMs: number;
  trackingState: TrackingState;
}

export interface ARAnchorManagerOptions {
  smoothingFactor: number;
  /** ms of no detection before an anchor is marked LOST (spec section 14). */
  trackingLostTimeoutMs: number;
  /** ms of no detection before DEGRADED (still shown, using last known
   * transform) — a shorter warning stage before full LOST. */
  degradedAfterMs: number;
}

const DEFAULT_OPTIONS: ARAnchorManagerOptions = {
  smoothingFactor: 0.35,
  trackingLostTimeoutMs: 1200,
  degradedAfterMs: 300,
};

/**
 * Central AR anchor state. Consumes ALREADY-normalized perception data
 * (HandObservation/FaceObservation/PoseObservation — the same types
 * `VisionPipeline`/`normalizeMediaPipeResults` already produce in Phase 3)
 * — this class creates no camera or MediaPipe access of its own, per the
 * spec's explicit "reuse, don't duplicate" instruction.
 *
 * Implements only the anchor types the current detector pipeline can
 * reliably support (`IMPLEMENTED_ANCHOR_TYPES`), tracking-loss handling
 * (spec section 14: hold last transform through a short gap, mark LOST
 * after a longer timeout, reacquire smoothly on return — smoothing state
 * is intentionally NOT reset on a short gap, only on a full LOST->TRACKING
 * reacquisition, so a brief dropout doesn't cause a visible snap).
 */
export class ARAnchorManager {
  private anchors = new Map<string, TrackedAnchorState>();
  private options: ARAnchorManagerOptions;
  private mapper: CoordinateMapper;

  constructor(mapper: CoordinateMapper, options: Partial<ARAnchorManagerOptions> = {}) {
    this.mapper = mapper;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  setSmoothingFactor(factor: number): void {
    if (factor <= 0 || factor > 1) return;
    this.options.smoothingFactor = factor;
    for (const state of this.anchors.values()) state.positionSmoother.setFactor(factor);
  }

  /** Call once per processed frame with whatever perception data is
   * currently available (any of these may be empty/null if that modality
   * is disabled — spec section 32: a disabled modality's detector never
   * even runs upstream, so there's nothing here to "discard"). */
  update(nowMs: number, hands: HandObservation[], face: FaceObservation | null, pose: PoseObservation | null): void {
    const seenIds = new Set<string>();

    for (const hand of hands) {
      const source = handSource(hand.handedness, hand.id);
      this.updateHandAnchors(hand, source, nowMs, seenIds);
    }

    if (face?.detected) {
      this.updateFaceAnchor(face, nowMs, seenIds);
    }

    if (pose?.detected) {
      this.updatePoseAnchors(pose, nowMs, seenIds);
    }

    this.expireUnseenAnchors(nowMs, seenIds);
  }

  getAnchor(id: string): Anchor | undefined {
    return this.anchors.get(id)?.anchor;
  }

  getAllAnchors(): Anchor[] {
    return [...this.anchors.values()].map((s) => s.anchor);
  }

  getTrackingState(id: string): TrackingState {
    return this.anchors.get(id)?.trackingState ?? "UNAVAILABLE";
  }

  reset(): void {
    this.anchors.clear();
  }

  private updateHandAnchors(hand: HandObservation, source: "left_hand" | "right_hand", nowMs: number, seenIds: Set<string>): void {
    const wrist = hand.landmarks[0];
    const indexMcp = hand.landmarks[5];
    const thumbTip = hand.landmarks[4];
    const middleMcp = hand.landmarks[9]; // rough palm-center reference
    if (!wrist) return;

    const orientation = estimateHandOrientation(hand);

    const specs: Array<{ type: AnchorType; landmark: typeof wrist | undefined }> = [
      { type: "HAND_WRIST", landmark: wrist },
      { type: "HAND_PALM", landmark: middleMcp },
      { type: "HAND_INDEX", landmark: indexMcp },
      { type: "HAND_THUMB", landmark: thumbTip },
    ];

    for (const spec of specs) {
      if (!spec.landmark) continue;
      const id = `${source}:${spec.type}`;
      seenIds.add(id);
      const mapped = this.mapper.mapToWorld(spec.landmark);
      this.upsertAnchor(id, spec.type, source, mapped.world, orientation, hand.confidence, nowMs);
    }
  }

  private updateFaceAnchor(face: FaceObservation, nowMs: number, seenIds: Set<string>): void {
    // Nose tip / face-mesh landmark 1 is a reasonably stable center-of-face
    // reference in MediaPipe's face mesh topology.
    const landmark = face.landmarks[1] ?? face.landmarks[0];
    if (!landmark) return;
    const id = "face:FACE";
    seenIds.add(id);
    const mapped = this.mapper.mapToWorld(landmark);
    const rotation = face.headPose ? eulerDegToQuaternion(face.headPose) : IDENTITY_QUATERNION;
    this.upsertAnchor(id, "FACE", "face", mapped.world, rotation, face.confidence, nowMs);
  }

  private updatePoseAnchors(pose: PoseObservation, nowMs: number, seenIds: Set<string>): void {
    const { leftShoulder, rightShoulder } = pose.landmarks;
    if (leftShoulder) {
      const id = "pose:LEFT_SHOULDER";
      seenIds.add(id);
      this.upsertAnchor(id, "LEFT_SHOULDER", "pose", this.mapper.mapToWorld(leftShoulder).world, IDENTITY_QUATERNION, pose.confidence, nowMs);
    }
    if (rightShoulder) {
      const id = "pose:RIGHT_SHOULDER";
      seenIds.add(id);
      this.upsertAnchor(id, "RIGHT_SHOULDER", "pose", this.mapper.mapToWorld(rightShoulder).world, IDENTITY_QUATERNION, pose.confidence, nowMs);
    }
    if (leftShoulder && rightShoulder) {
      const id = "pose:TORSO";
      seenIds.add(id);
      const midpoint = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 + 0.15, z: (leftShoulder.z + rightShoulder.z) / 2 };
      this.upsertAnchor(id, "TORSO", "pose", this.mapper.mapToWorld(midpoint).world, IDENTITY_QUATERNION, pose.confidence, nowMs);
    }
  }

  private upsertAnchor(
    id: string, type: AnchorType, source: Anchor["source"],
    worldPos: { x: number; y: number; z: number }, rotation: Quaternion, confidence: number, nowMs: number
  ): void {
    let state = this.anchors.get(id);
    if (!state) {
      state = {
        anchor: { id, type, source, position: worldPos, rotation, scale: 1, confidence, visible: true },
        positionSmoother: new ExponentialSmoother(this.options.smoothingFactor),
        rotationSmoother: new QuaternionSmoother(this.options.smoothingFactor),
        lastSeenMs: nowMs,
        trackingState: "INITIALIZING",
      };
      this.anchors.set(id, state);
    }

    const wasLost = state.trackingState === "LOST";
    if (wasLost) {
      // Reacquisition: reset smoothing so the object doesn't slerp/lerp
      // all the way from its old stale position — spec section 14's
      // "when tracking returns, reacquire smoothly" means smooth FROM the
      // reacquisition point forward, not smooth THROUGH the gap.
      state.positionSmoother.reset();
      state.rotationSmoother.reset();
    }

    state.anchor.position = state.positionSmoother.smooth(worldPos);
    state.anchor.rotation = state.rotationSmoother.smooth(rotation);
    state.anchor.confidence = confidence;
    state.anchor.visible = true;
    state.lastSeenMs = nowMs;
    state.trackingState = "TRACKING";
  }

  private expireUnseenAnchors(nowMs: number, seenIds: Set<string>): void {
    for (const [id, state] of this.anchors) {
      if (seenIds.has(id)) continue;
      const elapsed = nowMs - state.lastSeenMs;
      if (elapsed > this.options.trackingLostTimeoutMs) {
        state.trackingState = "LOST";
        state.anchor.visible = false; // hide per spec section 14, after the full timeout — not before
      } else if (elapsed > this.options.degradedAfterMs) {
        state.trackingState = "DEGRADED";
        // Keep last valid transform and stay visible — spec section 14:
        // "during short loss: keep last valid transform."
      }
    }
  }
}

function handSource(handedness: Handedness, fallbackId: string): "left_hand" | "right_hand" {
  // Spec section 15's explicit warning: don't blindly assume array index
  // == handedness. We use MediaPipe's own handedness classification when
  // available (which normalizeHandResult already validates in Phase 3);
  // "Unknown" falls back to a stable per-track-id assignment so the SAME
  // physical hand doesn't flip identity frame-to-frame even if MediaPipe's
  // handedness confidence briefly dips.
  if (handedness === "Left") return "left_hand";
  if (handedness === "Right") return "right_hand";
  return fallbackId.includes("1") ? "right_hand" : "left_hand";
}

function eulerDegToQuaternion(pose: { yaw: number; pitch: number; roll: number }): Quaternion {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = toRad(pose.yaw) / 2, p = toRad(pose.pitch) / 2, r = toRad(pose.roll) / 2;
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}
