import type { Vec3 } from "../design3d/types";

// ---------------------------------------------------------------------
// Anchors — spec section 7
// ---------------------------------------------------------------------

export type AnchorType =
  | "HAND_WRIST" | "HAND_PALM" | "HAND_INDEX" | "HAND_THUMB"
  | "FACE" | "HEAD" | "TORSO" | "LEFT_SHOULDER" | "RIGHT_SHOULDER";

/** Only anchors the current detector pipeline can actually, reliably
 * produce are implemented — spec section 7's "do not implement all anchors
 * if the underlying detector doesn't reliably provide them." Face/Head/
 * Torso/Shoulder anchors require `MediaPipeFaceProvider`/`MediaPipePoseProvider`
 * (Phase 3, PARTIALLY IMPLEMENTED/NOT HARDWARE VERIFIED there already) —
 * their AR anchor support here inherits that same unverified status rather
 * than pretending to be more solid than its inputs. */
export const IMPLEMENTED_ANCHOR_TYPES: AnchorType[] = [
  "HAND_WRIST", "HAND_PALM", "HAND_INDEX", "HAND_THUMB", "FACE", "TORSO", "LEFT_SHOULDER", "RIGHT_SHOULDER",
];

export interface Quaternion {
  x: number; y: number; z: number; w: number;
}

export const IDENTITY_QUATERNION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

export interface Anchor {
  id: string;
  type: AnchorType;
  source: "left_hand" | "right_hand" | "face" | "pose";
  position: Vec3;        // camera-relative estimated position, see CoordinateMapper's doc comment — NOT metric
  rotation: Quaternion;
  scale: number;          // relative scale factor derived from detected feature size, not metric either
  confidence: number;     // 0..1
  visible: boolean;
}

// ---------------------------------------------------------------------
// Tracking quality — spec section 39
// ---------------------------------------------------------------------

export type TrackingState = "UNAVAILABLE" | "INITIALIZING" | "TRACKING" | "DEGRADED" | "LOST";

// ---------------------------------------------------------------------
// AR object instance — spec sections 11, 12. Separates AR PLACEMENT from
// the DESIGN itself (DesignGraph remains the sole source of truth for
// geometry/material/parameters).
// ---------------------------------------------------------------------

export type ARInteractionMode = "IDLE" | "HOVER" | "GRABBING" | "TWO_HAND_TRANSFORMING";

export interface AROffset {
  position: Vec3;
  rotation: Quaternion;
  scaleMultiplier: number;
}

export const IDENTITY_OFFSET: AROffset = { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_QUATERNION, scaleMultiplier: 1 };

export interface ARObjectInstance {
  id: string;
  designObjectId: string; // references DesignGraph — geometry is never duplicated here
  anchorType: AnchorType | null; // null = unanchored / free-floating in the AR scene
  anchorId: string | null;
  offset: AROffset;
  visible: boolean;
  interactionMode: ARInteractionMode;
}

// ---------------------------------------------------------------------
// Calibration — spec section 26
// ---------------------------------------------------------------------

export interface ARCalibration {
  schemaVersion: string;
  objectSizeMultiplier: number;
  wristOffset: Vec3;
  rotationOffsetDegrees: Vec3;
  cameraScale: number;
  smoothingFactor: number; // 0..1, see Smoothing.ts
}

export const CALIBRATION_SCHEMA_VERSION = "1.0";

export const DEFAULT_CALIBRATION: ARCalibration = {
  schemaVersion: CALIBRATION_SCHEMA_VERSION,
  objectSizeMultiplier: 1,
  wristOffset: { x: 0, y: 0, z: 0 },
  rotationOffsetDegrees: { x: 0, y: 0, z: 0 },
  cameraScale: 1,
  smoothingFactor: 0.35,
};

// ---------------------------------------------------------------------
// AR commands — spec section 35. Same validate-before-execute discipline
// as Phase 4's DesignCommand system; nothing here bypasses DesignGraph.
// ---------------------------------------------------------------------

export type ARCommand =
  | { type: "ATTACH_AR_OBJECT"; instanceId: string; designObjectId: string; anchorType: AnchorType }
  | { type: "DETACH_AR_OBJECT"; instanceId: string }
  | { type: "SET_AR_ANCHOR"; instanceId: string; anchorType: AnchorType }
  | { type: "SET_AR_OFFSET"; instanceId: string; offset: Partial<AROffset> }
  | { type: "SET_AR_SCALE"; instanceId: string; scaleMultiplier: number }
  | { type: "SET_AR_ROTATION"; instanceId: string; rotationDegrees: Vec3 }
  | { type: "SHOW_AR_OBJECT"; instanceId: string }
  | { type: "HIDE_AR_OBJECT"; instanceId: string }
  | { type: "START_AR_INTERACTION"; instanceId: string }
  | { type: "STOP_AR_INTERACTION"; instanceId: string };

export const ALL_AR_COMMAND_TYPES = [
  "ATTACH_AR_OBJECT", "DETACH_AR_OBJECT", "SET_AR_ANCHOR", "SET_AR_OFFSET", "SET_AR_SCALE",
  "SET_AR_ROTATION", "SHOW_AR_OBJECT", "HIDE_AR_OBJECT", "START_AR_INTERACTION", "STOP_AR_INTERACTION",
] as const;

export const AR_SCALE_LIMITS = { min: 0.05, max: 20 };

// ---------------------------------------------------------------------
// Depth — spec sections 24, 25. Never fabricated.
// ---------------------------------------------------------------------

export interface DepthCapabilities {
  metric: boolean; // true only for real depth hardware — always false for MonocularDepthProvider
  relative: boolean;
}

export interface DepthProvider {
  isAvailable(): boolean;
  getCapabilities(): DepthCapabilities;
  /** Returns a RELATIVE depth estimate (not metric) unless
   * getCapabilities().metric is true. Range and meaning are
   * provider-specific — callers must check capabilities before
   * interpreting the number as anything more than "nearer/farther." */
  getDepth(normalizedX: number, normalizedY: number): number | null;
}
