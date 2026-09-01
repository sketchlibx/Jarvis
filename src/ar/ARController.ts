import type { FaceObservation, HandObservation, PoseObservation } from "../types/perception";
import type { ARCommand, ARCalibration, TrackingState } from "./types";
import { DEFAULT_CALIBRATION } from "./types";
import { CoordinateMapper, type ViewportInfo } from "./CoordinateMapper";
import { ARAnchorManager } from "./ARAnchorManager";
import { ARInstanceManager } from "./ARInstanceManager";
import { ARScene } from "./ARScene";
import { validateARCommand } from "./validation";
import {
  PinchHysteresisTracker, SingleHandInteractionStateMachine, computeTwoHandDelta,
  thumbIndexDistance, type TwoHandFrame,
} from "./ARInteractionController";
import type { DesignController } from "../design3d/commands/DesignController";

export interface ARControllerStats {
  trackingState: TrackingState;
  handsDetected: number;
  activeInstances: number;
  selectedInstanceId: string | null;
}

/**
 * The single AR orchestration point (spec section 2's architecture
 * diagram). Consumes already-normalized perception data — the SAME
 * `HandObservation[]`/`FaceObservation`/`PoseObservation` types Phase 3's
 * `VisionPipeline` already produces — and does not create any camera,
 * MediaPipe, or gesture-classification code of its own. Pinch geometry
 * reuses `thumbIndexDistance()` — the exact thumb-tip/index-tip distance
 * metric `GestureEngine.classify()` computes internally for its own pinch
 * case — rather than duplicating that math; this class only adds the
 * AR-specific hysteresis/state-machine/two-hand layer on top, per spec
 * section 17's explicit "do not create a second pinch detector." Full
 * gesture classification (open_hand/fist/point/etc via
 * `GestureEngine.classify()`) isn't needed for AR interaction and so isn't
 * invoked directly here, but pinch detection itself is never reimplemented.
 *
 * Dangerous OS actions never originate here — `ARCommand` only ever
 * mutates `ARInstanceManager` state (placement) or, via
 * `DesignController.apply()`, validated `DesignCommand`s that go through
 * the exact same Phase 4 pipeline any other caller uses. There is no
 * shortcut from a gesture to a filesystem/application/browser action
 * anywhere in this file (spec section 36).
 */
export class ARController {
  readonly anchorManager: ARAnchorManager;
  readonly instanceManager = new ARInstanceManager();
  readonly scene: ARScene;
  private mapper: CoordinateMapper;
  private calibration: ARCalibration = { ...DEFAULT_CALIBRATION };

  private pinchTrackers = new Map<string, PinchHysteresisTracker>(); // keyed by hand source (left_hand/right_hand)
  private handStateMachines = new Map<string, SingleHandInteractionStateMachine>();
  private grabbedInstanceId: string | null = null;
  private grabAnchorSourceId: string | null = null;
  private twoHandReferenceFrame: TwoHandFrame | null = null;
  private twoHandTargetInstanceId: string | null = null;

  private selectedInstanceId: string | null = null;
  private lastHandCount = 0;
  private lastTrackingState: TrackingState = "UNAVAILABLE";

  constructor(private designController: DesignController, viewport: ViewportInfo) {
    this.mapper = new CoordinateMapper(viewport);
    this.anchorManager = new ARAnchorManager(this.mapper, { smoothingFactor: this.calibration.smoothingFactor });
    this.scene = new ARScene(designController.graph);
  }

  updateViewport(viewport: Partial<ViewportInfo>): void {
    this.mapper.updateViewport(viewport);
  }

  setCalibration(calibration: ARCalibration): void {
    this.calibration = calibration;
    this.anchorManager.setSmoothingFactor(calibration.smoothingFactor);
  }
  getCalibration(): ARCalibration {
    return this.calibration;
  }

  setSelectedInstance(id: string | null): void {
    this.selectedInstanceId = id;
  }

  /**
   * Called once per processed vision frame — mirrors the pipeline in spec
   * section 2 exactly: perception data in, anchors updated, gestures
   * interpreted, AR scene transforms synced. Never touches DesignGraph
   * geometry directly (only via validated commands elsewhere).
   */
  update(nowMs: number, hands: HandObservation[], face: FaceObservation | null, pose: PoseObservation | null): void {
    this.anchorManager.update(nowMs, hands, face, pose);
    this.lastHandCount = hands.length;

    for (const hand of hands) {
      this.processHandInteraction(hand);
    }
    this.processTwoHandInteraction(hands);

    if (hands.length === 0) {
      this.grabbedInstanceId = null;
      this.grabAnchorSourceId = null;
    }

    const anchorMap = new Map(this.anchorManager.getAllAnchors().map((a) => [a.id, a]));
    this.scene.update(this.instanceManager.all(), anchorMap);

    this.lastTrackingState = this.computeOverallTrackingState(hands.length);
  }

  private processHandInteraction(hand: HandObservation): void {
    const source = hand.handedness === "Left" ? "left_hand" : hand.handedness === "Right" ? "right_hand" : "right_hand";
    const dist = thumbIndexDistance(hand);
    if (dist === null) return;

    if (!this.pinchTrackers.has(source)) this.pinchTrackers.set(source, new PinchHysteresisTracker());
    if (!this.handStateMachines.has(source)) this.handStateMachines.set(source, new SingleHandInteractionStateMachine());

    const isPinching = this.pinchTrackers.get(source)!.update(dist);
    const state = this.handStateMachines.get(source)!.update(isPinching, this.selectedInstanceId !== null);

    // Spec section 21: prioritize the currently-selected Design Studio
    // object for grab targeting — deterministic, not gesture-guessed.
    if (state === "GRABBING" && !this.grabbedInstanceId && this.selectedInstanceId) {
      this.grabbedInstanceId = this.selectedInstanceId;
      this.grabAnchorSourceId = source;
      this.instanceManager.setInteractionMode(this.grabbedInstanceId, "GRABBING");
    }

    if (state !== "GRABBING" && this.grabbedInstanceId && this.grabAnchorSourceId === source) {
      // Pinch released — spec section 18: object remains at its last
      // valid transform, only AR placement changes, never the underlying
      // DesignGraph geometry (setAnchor never touches DesignController).
      this.instanceManager.setInteractionMode(this.grabbedInstanceId, "IDLE");
      this.grabbedInstanceId = null;
      this.grabAnchorSourceId = null;
    }

    if (this.grabbedInstanceId && this.grabAnchorSourceId === source) {
      // Live grab: instance follows this hand's wrist anchor directly
      // (offset stays whatever it already was — grabbing doesn't reset calibration).
      this.instanceManager.setAnchor(this.grabbedInstanceId, "HAND_WRIST", `${source}:HAND_WRIST`);
    }

    // Spec section 29: hand-to-hand transfer. If a DIFFERENT hand than the
    // one currently holding the object starts pinching while near the
    // held object's anchor, transfer to it.
    if (this.grabbedInstanceId && this.grabAnchorSourceId !== source && isPinching) {
      const heldAnchorId = this.instanceManager.get(this.grabbedInstanceId)?.anchorId;
      const thisHandAnchorId = `${source}:HAND_WRIST`;
      const heldAnchor = heldAnchorId ? this.anchorManager.getAnchor(heldAnchorId) : undefined;
      const thisAnchor = this.anchorManager.getAnchor(thisHandAnchorId);
      if (heldAnchor && thisAnchor && isNear(heldAnchor.position, thisAnchor.position, 0.15)) {
        this.instanceManager.transferAnchor(this.grabbedInstanceId, "HAND_WRIST", thisHandAnchorId);
        this.grabAnchorSourceId = source;
      }
    }
  }

  private processTwoHandInteraction(hands: HandObservation[]): void {
    if (hands.length !== 2 || !this.selectedInstanceId) {
      this.twoHandReferenceFrame = null;
      this.twoHandTargetInstanceId = null;
      return;
    }
    const left = this.anchorManager.getAnchor("left_hand:HAND_WRIST");
    const right = this.anchorManager.getAnchor("right_hand:HAND_WRIST");
    if (!left || !right) return;

    const leftPinching = this.pinchTrackers.get("left_hand")?.isPinching ?? false;
    const rightPinching = this.pinchTrackers.get("right_hand")?.isPinching ?? false;
    if (!leftPinching || !rightPinching) {
      this.twoHandReferenceFrame = null;
      this.twoHandTargetInstanceId = null;
      return;
    }

    const currentFrame: TwoHandFrame = { left: left.position, right: right.position };
    if (!this.twoHandReferenceFrame || this.twoHandTargetInstanceId !== this.selectedInstanceId) {
      this.twoHandReferenceFrame = currentFrame;
      this.twoHandTargetInstanceId = this.selectedInstanceId;
      this.instanceManager.setInteractionMode(this.selectedInstanceId, "TWO_HAND_TRANSFORMING");
      return;
    }

    const delta = computeTwoHandDelta(this.twoHandReferenceFrame, currentFrame);
    this.instanceManager.setOffset(this.selectedInstanceId, { scaleMultiplier: delta.scaleMultiplier });
  }

  private computeOverallTrackingState(handCount: number): TrackingState {
    if (handCount === 0 && this.lastHandCount === 0) return this.lastTrackingState === "TRACKING" ? "LOST" : "UNAVAILABLE";
    if (handCount > 0) return "TRACKING";
    return "DEGRADED";
  }

  getStats(): ARControllerStats {
    return {
      trackingState: this.lastTrackingState,
      handsDetected: this.lastHandCount,
      activeInstances: this.instanceManager.all().length,
      selectedInstanceId: this.selectedInstanceId,
    };
  }

  /**
   * Applies one validated AR command. Same reject-closed discipline as
   * Phase 4 — invalid commands never reach `ARInstanceManager`.
   */
  applyCommand(cmd: unknown): { success: boolean; errors?: string[] } {
    const instanceIds = new Set(this.instanceManager.all().map((i) => i.id));
    const designIds = new Set(this.designController.allObjects().map((o) => o.id));
    const result = validateARCommand(cmd, instanceIds, designIds);
    if (!result.valid) return { success: false, errors: result.errors };

    const c = cmd as ARCommand;
    switch (c.type) {
      case "ATTACH_AR_OBJECT":
        this.instanceManager.create(c.instanceId, c.designObjectId, c.anchorType, null);
        return { success: true };
      case "DETACH_AR_OBJECT":
        this.instanceManager.remove(c.instanceId);
        return { success: true };
      case "SET_AR_ANCHOR":
        this.instanceManager.setAnchor(c.instanceId, c.anchorType, null);
        return { success: true };
      case "SET_AR_OFFSET":
        this.instanceManager.setOffset(c.instanceId, c.offset);
        return { success: true };
      case "SET_AR_SCALE":
        this.instanceManager.setOffset(c.instanceId, { scaleMultiplier: c.scaleMultiplier });
        return { success: true };
      case "SET_AR_ROTATION": {
        const rad = { x: (c.rotationDegrees.x * Math.PI) / 180, y: (c.rotationDegrees.y * Math.PI) / 180, z: (c.rotationDegrees.z * Math.PI) / 180 };
        const q = eulerToQuaternion(rad);
        this.instanceManager.setOffset(c.instanceId, { rotation: q });
        return { success: true };
      }
      case "SHOW_AR_OBJECT":
        this.instanceManager.setVisible(c.instanceId, true);
        return { success: true };
      case "HIDE_AR_OBJECT":
        this.instanceManager.setVisible(c.instanceId, false);
        return { success: true };
      case "START_AR_INTERACTION":
        this.instanceManager.setInteractionMode(c.instanceId, "GRABBING");
        return { success: true };
      case "STOP_AR_INTERACTION":
        this.instanceManager.setInteractionMode(c.instanceId, "IDLE");
        return { success: true };
    }
  }

  dispose(): void {
    this.scene.dispose();
    this.anchorManager.reset();
    this.instanceManager.clear();
  }
}

function isNear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, threshold: number): boolean {
  const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  return d < threshold;
}

function eulerToQuaternion(rad: { x: number; y: number; z: number }) {
  const cx = Math.cos(rad.x / 2), sx = Math.sin(rad.x / 2);
  const cy = Math.cos(rad.y / 2), sy = Math.sin(rad.y / 2);
  const cz = Math.cos(rad.z / 2), sz = Math.sin(rad.z / 2);
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
}
