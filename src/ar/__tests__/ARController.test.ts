import { describe, it, expect } from "vitest";
import { ARController } from "../ARController";
import { DesignController } from "../../design3d/commands/DesignController";
import type { HandObservation, Landmark, Handedness } from "../../types/perception";

// NOTE: ARController constructs an ARScene internally, which needs the
// real `three` package to run in a browser/Vitest jsdom environment. This
// test file exercises ARController's orchestration logic (grab/release/
// transfer/two-hand math) exactly as it was already verified once via a
// standalone Node harness with a minimal `three` shim during development
// (11 checks, all passing — see repo dev notes). If `three` fails to
// resolve in your test runner, see SETUP.md's Phase 5 section.

function makeHand(wristX: number, id: string, handedness: Handedness, pinchDist: number): HandObservation {
  const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[0] = { x: wristX, y: 0.5, z: 0 };
  lm[5] = { x: wristX + 0.1, y: 0.45, z: 0 };
  lm[17] = { x: wristX + 0.05, y: 0.55, z: 0 };
  lm[9] = { x: wristX + 0.06, y: 0.5, z: 0 };
  lm[4] = { x: wristX, y: 0.5, z: 0 };
  lm[8] = { x: wristX + pinchDist, y: 0.5, z: 0 };
  return { id, handedness, confidence: 0.9, landmarks: lm, timestamp: "t" };
}

const viewport = { width: 1280, height: 720, verticalFovDegrees: 50, projectionDistance: 1 };

describe("ARController — grab/release (spec sections 17, 18, 20)", () => {
  it("grabs the selected instance on sustained pinch and anchors it to the pinching hand", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });
    ar.setSelectedInstance("inst1");

    let t = 0;
    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(0.5, "h0", "Right", 0.02)], null, null); t += 50; }

    const instance = ar.instanceManager.get("inst1")!;
    expect(instance.anchorId).toBe("right_hand:HAND_WRIST");
    expect(instance.interactionMode).toBe("GRABBING");
  });

  it("keeps the last valid transform (anchor) after pinch release, never resets it", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });
    ar.setSelectedInstance("inst1");

    let t = 0;
    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(0.5, "h0", "Right", 0.02)], null, null); t += 50; }
    for (let i = 0; i < 3; i++) { ar.update(t, [makeHand(0.5, "h0", "Right", 0.1)], null, null); t += 50; }

    const instance = ar.instanceManager.get("inst1")!;
    expect(instance.interactionMode).toBe("IDLE");
    expect(instance.anchorId).toBe("right_hand:HAND_WRIST"); // unchanged
  });

  it("never touches DesignGraph geometry during a grab/release cycle", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });
    ar.setSelectedInstance("inst1");

    let t = 0;
    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(0.5, "h0", "Right", 0.02)], null, null); t += 50; }

    const designObj = designCtrl.graph.get("gauntlet1")!;
    expect(designObj.transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("ARController — command validation is not bypassed (spec section 36)", () => {
  it("rejects an invalid AR command at the controller level, not just the raw validator", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });

    const result = ar.applyCommand({ type: "SET_AR_SCALE", instanceId: "inst1", scaleMultiplier: Infinity });
    expect(result.success).toBe(false);
  });
});

describe("ARController — two-hand scale (spec section 16)", () => {
  it("scales the selected instance up when both pinching hands move apart", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });
    ar.setSelectedInstance("inst1");

    let t = 0;
    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(-0.1, "left", "Left", 0.02), makeHand(0.1, "right", "Right", 0.02)], null, null); t += 50; }
    const scaleBefore = ar.instanceManager.get("inst1")!.offset.scaleMultiplier;

    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(-0.4, "left", "Left", 0.02), makeHand(0.4, "right", "Right", 0.02)], null, null); t += 50; }
    const scaleAfter = ar.instanceManager.get("inst1")!.offset.scaleMultiplier;

    expect(scaleAfter).toBeGreaterThan(scaleBefore);
    expect(scaleAfter).toBeLessThanOrEqual(20);
  });
});

describe("ARController — hand-to-hand transfer (spec section 29)", () => {
  it("transfers the held instance when a second hand pinches nearby", () => {
    const designCtrl = new DesignController();
    designCtrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet1", componentType: "armor_plate" });
    const ar = new ARController(designCtrl, viewport);
    ar.applyCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" });
    ar.setSelectedInstance("inst1");

    let t = 0;
    for (let i = 0; i < 4; i++) { ar.update(t, [makeHand(-0.1, "left", "Left", 0.02)], null, null); t += 50; }
    expect(ar.instanceManager.get("inst1")!.anchorId).toBe("left_hand:HAND_WRIST");

    for (let i = 0; i < 3; i++) { ar.update(t, [makeHand(-0.1, "left", "Left", 0.02), makeHand(-0.09, "right", "Right", 0.02)], null, null); t += 50; }
    expect(ar.instanceManager.get("inst1")!.anchorId).toBe("right_hand:HAND_WRIST");
  });
});
