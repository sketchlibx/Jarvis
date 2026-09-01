import { describe, it, expect } from "vitest";
import { ARAnchorManager } from "../ARAnchorManager";
import { CoordinateMapper } from "../CoordinateMapper";
import type { HandObservation, Landmark } from "../../types/perception";

function makeHand(wristX: number, id: string, handedness: "Left" | "Right"): HandObservation {
  const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[0] = { x: wristX, y: 0.5, z: 0 };
  lm[5] = { x: wristX + 0.1, y: 0.45, z: 0 };
  lm[17] = { x: wristX + 0.05, y: 0.55, z: 0 };
  lm[4] = { x: wristX + 0.02, y: 0.48, z: 0 };
  lm[9] = { x: wristX + 0.06, y: 0.5, z: 0 };
  return { id, handedness, confidence: 0.9, landmarks: lm, timestamp: "t" };
}

const viewport = { width: 1280, height: 720, verticalFovDegrees: 50, projectionDistance: 1 };

describe("ARAnchorManager — tracking states (spec section 14, 39)", () => {
  it("goes from TRACKING through DEGRADED to LOST as the gap grows", () => {
    const mapper = new CoordinateMapper(viewport);
    const manager = new ARAnchorManager(mapper, { trackingLostTimeoutMs: 500, degradedAfterMs: 100 });

    manager.update(0, [makeHand(0.5, "hand_0", "Right")], null, null);
    expect(manager.getTrackingState("right_hand:HAND_WRIST")).toBe("TRACKING");

    manager.update(300, [], null, null);
    expect(manager.getTrackingState("right_hand:HAND_WRIST")).toBe("DEGRADED");
    expect(manager.getAnchor("right_hand:HAND_WRIST")?.visible).toBe(true);

    manager.update(700, [], null, null);
    expect(manager.getTrackingState("right_hand:HAND_WRIST")).toBe("LOST");
    expect(manager.getAnchor("right_hand:HAND_WRIST")?.visible).toBe(false);
  });

  it("reacquires (goes back to TRACKING, becomes visible again) when the hand returns", () => {
    const mapper = new CoordinateMapper(viewport);
    const manager = new ARAnchorManager(mapper, { trackingLostTimeoutMs: 200, degradedAfterMs: 50 });
    manager.update(0, [makeHand(0.5, "hand_0", "Right")], null, null);
    manager.update(500, [], null, null);
    expect(manager.getTrackingState("right_hand:HAND_WRIST")).toBe("LOST");

    manager.update(550, [makeHand(0.5, "hand_0", "Right")], null, null);
    expect(manager.getTrackingState("right_hand:HAND_WRIST")).toBe("TRACKING");
    expect(manager.getAnchor("right_hand:HAND_WRIST")?.visible).toBe(true);
  });
});

describe("ARAnchorManager — multi-hand identity (spec section 15)", () => {
  it("keeps left and right hand anchors distinct and positioned differently", () => {
    const mapper = new CoordinateMapper(viewport);
    const manager = new ARAnchorManager(mapper);
    manager.update(0, [makeHand(0.2, "h0", "Left"), makeHand(0.8, "h1", "Right")], null, null);

    const left = manager.getAnchor("left_hand:HAND_WRIST");
    const right = manager.getAnchor("right_hand:HAND_WRIST");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left!.id).not.toBe(right!.id);
    expect(left!.position.x).not.toBe(right!.position.x);
  });
});
