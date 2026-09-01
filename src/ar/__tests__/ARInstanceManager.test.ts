import { describe, it, expect } from "vitest";
import { ARInstanceManager } from "../ARInstanceManager";

describe("ARInstanceManager — spec sections 11, 12, 29", () => {
  it("creates an instance that references a design object without duplicating geometry", () => {
    const mgr = new ARInstanceManager();
    const instance = mgr.create("inst_a", "gauntlet1", "HAND_WRIST", "right_hand:HAND_WRIST");
    expect(instance.designObjectId).toBe("gauntlet1");
    expect("parameters" in instance).toBe(false);
    expect("material" in instance).toBe(false);
  });

  it("transfers an instance's anchor virtually (hand-to-hand transfer)", () => {
    const mgr = new ARInstanceManager();
    mgr.create("inst_a", "gauntlet1", "HAND_WRIST", "left_hand:HAND_WRIST");
    mgr.transferAnchor("inst_a", "HAND_WRIST", "right_hand:HAND_WRIST");
    expect(mgr.get("inst_a")?.anchorId).toBe("right_hand:HAND_WRIST");
  });

  it("finds instances currently on a given anchor", () => {
    const mgr = new ARInstanceManager();
    mgr.create("inst_a", "gauntlet1", "HAND_WRIST", "left_hand:HAND_WRIST");
    expect(mgr.instancesOnAnchor("left_hand:HAND_WRIST")).toHaveLength(1);
    expect(mgr.instancesOnAnchor("right_hand:HAND_WRIST")).toHaveLength(0);
  });

  it("toggles visibility and updates offset independently", () => {
    const mgr = new ARInstanceManager();
    mgr.create("inst_a", "gauntlet1", null, null);
    mgr.setVisible("inst_a", false);
    expect(mgr.get("inst_a")?.visible).toBe(false);
    mgr.setOffset("inst_a", { scaleMultiplier: 1.5 });
    expect(mgr.get("inst_a")?.offset.scaleMultiplier).toBe(1.5);
    expect(mgr.get("inst_a")?.offset.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("returns false from mutators when the instance doesn't exist, rather than throwing", () => {
    const mgr = new ARInstanceManager();
    expect(mgr.setVisible("ghost", true)).toBe(false);
    expect(mgr.setOffset("ghost", {})).toBe(false);
    expect(mgr.transferAnchor("ghost", "HAND_WRIST", "x")).toBe(false);
  });
});
