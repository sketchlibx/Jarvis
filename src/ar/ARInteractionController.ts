import type { HandObservation } from "../types/perception";
import type { Vec3 } from "../design3d/types";
import { AR_SCALE_LIMITS } from "./types";

// ---------------------------------------------------------------------
// Pinch hysteresis — spec section 17. Reuses GestureEngine's existing
// pinch geometry (thumb tip <-> index tip distance) but adds hysteresis
// on top, since GestureEngine.classify() itself makes a single-frame,
// non-hysteretic decision — hysteresis is a temporal/interaction concern,
// not a per-frame geometry concern, so it belongs at this layer rather
// than duplicating/modifying GestureEngine.
// ---------------------------------------------------------------------

export interface PinchHysteresisOptions {
  /** Normalized thumb-index distance below which a pinch STARTS. */
  startThreshold: number;
  /** Normalized thumb-index distance above which a pinch RELEASES. Must be
   * greater than startThreshold — spec section 17's explicit example
   * (start < 0.045, release > 0.065) is a wide-band example; the important
   * property is releaseThreshold > startThreshold, not these exact numbers,
   * which depend on hand size/distance-from-camera in a real deployment. */
  releaseThreshold: number;
}

export const DEFAULT_PINCH_HYSTERESIS: PinchHysteresisOptions = {
  startThreshold: 0.045,
  releaseThreshold: 0.065,
};

export class PinchHysteresisTracker {
  private pinching = false;
  constructor(private options: PinchHysteresisOptions = DEFAULT_PINCH_HYSTERESIS) {
    if (options.releaseThreshold <= options.startThreshold) {
      throw new Error("releaseThreshold must be greater than startThreshold to avoid flicker");
    }
  }

  /** `thumbIndexDistance` — the same normalized landmark distance
   * GestureEngine computes internally for its own pinch classification;
   * callers typically pass `distance(hand.landmarks[4], hand.landmarks[8])`. */
  update(thumbIndexDistance: number): boolean {
    if (!this.pinching && thumbIndexDistance < this.options.startThreshold) {
      this.pinching = true;
    } else if (this.pinching && thumbIndexDistance > this.options.releaseThreshold) {
      this.pinching = false;
    }
    return this.pinching;
  }

  get isPinching(): boolean {
    return this.pinching;
  }

  reset(): void {
    this.pinching = false;
  }
}

export function thumbIndexDistance(hand: HandObservation): number | null {
  const thumb = hand.landmarks[4];
  const index = hand.landmarks[8];
  if (!thumb || !index) return null;
  return Math.sqrt((thumb.x - index.x) ** 2 + (thumb.y - index.y) ** 2 + (thumb.z - index.z) ** 2);
}

// ---------------------------------------------------------------------
// Gesture state machine — spec section 20. Explicit, requires multiple
// consistent frames before transitioning (spec: "do not infer interaction
// state from one frame").
// ---------------------------------------------------------------------

export type SingleHandState = "IDLE" | "HOVER" | "PINCH_START" | "GRABBING" | "PINCH_RELEASE";
export type TwoHandState = "IDLE" | "TWO_HAND_DETECTED" | "TWO_HAND_GRAB" | "TRANSFORMING" | "RELEASE";

export class SingleHandInteractionStateMachine {
  private state: SingleHandState = "IDLE";
  private consecutivePinchFrames = 0;
  private consecutiveReleaseFrames = 0;

  constructor(private requiredConsecutiveFrames: number = 2) {}

  update(isPinching: boolean, isHovering: boolean): SingleHandState {
    if (isPinching) {
      this.consecutivePinchFrames += 1;
      this.consecutiveReleaseFrames = 0;
    } else {
      this.consecutiveReleaseFrames += 1;
      this.consecutivePinchFrames = 0;
    }

    switch (this.state) {
      case "IDLE":
      case "HOVER":
        if (this.consecutivePinchFrames >= this.requiredConsecutiveFrames) {
          this.state = "PINCH_START";
        } else {
          this.state = isHovering ? "HOVER" : "IDLE";
        }
        break;
      case "PINCH_START":
        this.state = "GRABBING";
        break;
      case "GRABBING":
        if (this.consecutiveReleaseFrames >= this.requiredConsecutiveFrames) {
          this.state = "PINCH_RELEASE";
        }
        break;
      case "PINCH_RELEASE":
        this.state = isHovering ? "HOVER" : "IDLE";
        break;
    }
    return this.state;
  }

  get current(): SingleHandState {
    return this.state;
  }

  reset(): void {
    this.state = "IDLE";
    this.consecutivePinchFrames = 0;
    this.consecutiveReleaseFrames = 0;
  }
}

// ---------------------------------------------------------------------
// Two-hand transform math — spec section 16. Pure geometry: given two
// hand positions across two frames, derive scale/rotation/position deltas.
// ---------------------------------------------------------------------

export interface TwoHandFrame {
  left: Vec3;
  right: Vec3;
}

export interface TwoHandTransformDelta {
  scaleMultiplier: number;
  rotationDeltaDegrees: number;
  midpoint: Vec3;
}

/**
 * Computes a scale/rotation/position delta between a REFERENCE two-hand
 * frame (typically captured when two-hand interaction started) and the
 * CURRENT frame. Bounded per spec section 19 (min/max scale) so a
 * momentary bad reading can't produce NaN/Infinity/negative scale reaching
 * the DesignGraph (which would reject it anyway via Phase 4's validation —
 * this is defense in depth, not the only check).
 */
export function computeTwoHandDelta(reference: TwoHandFrame, current: TwoHandFrame): TwoHandTransformDelta {
  const refDist = distance2D(reference.left, reference.right);
  const curDist = distance2D(current.left, current.right);
  const rawScale = refDist > 1e-6 ? curDist / refDist : 1;
  const scaleMultiplier = clamp(rawScale, AR_SCALE_LIMITS.min, AR_SCALE_LIMITS.max);

  const refAngle = Math.atan2(reference.right.z - reference.left.z, reference.right.x - reference.left.x);
  const curAngle = Math.atan2(current.right.z - current.left.z, current.right.x - current.left.x);
  let deltaRad = curAngle - refAngle;
  while (deltaRad > Math.PI) deltaRad -= 2 * Math.PI;
  while (deltaRad <= -Math.PI) deltaRad += 2 * Math.PI;

  const midpoint = {
    x: (current.left.x + current.right.x) / 2,
    y: (current.left.y + current.right.y) / 2,
    z: (current.left.z + current.right.z) / 2,
  };

  return {
    scaleMultiplier: Number.isFinite(scaleMultiplier) ? scaleMultiplier : 1,
    rotationDeltaDegrees: Number.isFinite(deltaRad) ? (deltaRad * 180) / Math.PI : 0,
    midpoint,
  };
}

function distance2D(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(min, Math.min(max, v));
}
