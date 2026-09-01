import { describe, it, expect } from "vitest";
import { estimateHandOrientation } from "../HandOrientation";
import type { HandObservation, Landmark } from "../../types/perception";

function makeHand(wrist: Landmark, indexMcp: Landmark, pinkyMcp: Landmark): HandObservation {
  const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0, y: 0, z: 0 }));
  lm[0] = wrist; lm[5] = indexMcp; lm[17] = pinkyMcp;
  return { id: "h1", handedness: "Right", confidence: 0.9, landmarks: lm, timestamp: "t" };
}

describe("estimateHandOrientation", () => {
  it("returns a normalized quaternion for a well-formed hand", () => {
    const hand = makeHand({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 0.05, y: 0.08, z: 0 });
    const q = estimateHandOrientation(hand);
    const len = Math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2);
    expect(len).toBeCloseTo(1, 5);
  });

  it("never produces NaN even for degenerate (coincident) landmarks", () => {
    const hand = makeHand({ x: 0.5, y: 0.5, z: 0 }, { x: 0.5, y: 0.5, z: 0 }, { x: 0.5, y: 0.5, z: 0 });
    const q = estimateHandOrientation(hand);
    expect(Number.isNaN(q.x)).toBe(false);
    expect(Number.isNaN(q.y)).toBe(false);
    expect(Number.isNaN(q.z)).toBe(false);
    expect(Number.isNaN(q.w)).toBe(false);
  });

  it("returns identity when required landmarks are missing", () => {
    const hand: HandObservation = { id: "h2", handedness: "Right", confidence: 0.5, landmarks: [{ x: 0, y: 0, z: 0 }], timestamp: "t" };
    const q = estimateHandOrientation(hand);
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("produces a different orientation when the hand configuration changes", () => {
    const flat = makeHand({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 0.05, y: 0.08, z: 0 });
    const rotated = makeHand({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0.1 }, { x: 0.05, y: 0.08, z: 0.05 });
    expect(estimateHandOrientation(flat)).not.toEqual(estimateHandOrientation(rotated));
  });
});
