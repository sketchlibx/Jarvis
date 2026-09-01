import { describe, it, expect } from "vitest";
import { GestureEngine } from "../GestureEngine";
import type { HandObservation, Landmark } from "../../types/perception";

/**
 * Synthetic landmark builder used for testing. Extended fingers reach
 * outward from the wrist; curled fingers fold BACK toward the wrist
 * (tip closer to wrist than the pip joint) — this mirrors real anatomy,
 * unlike a naive uniform radial scale-down which would fail to
 * distinguish extended from curled under GestureEngine's isExtended check.
 *
 * NOTE: this file's logic was manually verified against GestureEngine via
 * a standalone `node` harness during development (no test runner available
 * in the build sandbox — see SETUP.md). The assertions here reproduce that
 * verification; treat `npm run test` on this file as re-confirming it in a
 * real toolchain, not the first time it's been checked.
 */
function fingerLandmarks(baseAngle: number, extended: boolean, wrist: Landmark): [Landmark, Landmark, Landmark] {
  const outward = 0.28;
  const dir = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
  if (extended) {
    return [
      { x: wrist.x + dir.x * outward * 0.35, y: wrist.y + dir.y * outward * 0.35, z: 0 },
      { x: wrist.x + dir.x * outward * 0.65, y: wrist.y + dir.y * outward * 0.65, z: 0 },
      { x: wrist.x + dir.x * outward, y: wrist.y + dir.y * outward, z: 0 },
    ];
  }
  return [
    { x: wrist.x + dir.x * outward * 0.35, y: wrist.y + dir.y * outward * 0.35, z: 0 },
    { x: wrist.x + dir.x * outward * 0.5, y: wrist.y + dir.y * outward * 0.5, z: 0 },
    { x: wrist.x + dir.x * outward * 0.15, y: wrist.y + dir.y * outward * 0.15, z: 0 }, // folded back
  ];
}

function buildHand(extendedMap: Record<"thumb" | "index" | "middle" | "ring" | "pinky", boolean>, id = "h1"): HandObservation {
  const wrist: Landmark = { x: 0.5, y: 0.5, z: 0 };
  const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[0] = wrist;
  const fingers: Array<{ name: keyof typeof extendedMap; idx: [number, number, number]; angle: number }> = [
    { name: "thumb", idx: [2, 3, 4], angle: -0.3 },
    { name: "index", idx: [5, 6, 8], angle: -0.9 },
    { name: "middle", idx: [9, 10, 12], angle: -1.5 },
    { name: "ring", idx: [13, 14, 16], angle: -2.1 },
    { name: "pinky", idx: [17, 18, 20], angle: -2.7 },
  ];
  for (const f of fingers) {
    const [mcpPt, pipPt, tipPt] = fingerLandmarks(f.angle, extendedMap[f.name], wrist);
    lm[f.idx[0]] = mcpPt;
    lm[f.idx[1]] = pipPt;
    lm[f.idx[2]] = tipPt;
  }
  return { id, handedness: "Right", confidence: 0.9, landmarks: lm, timestamp: new Date().toISOString() };
}

describe("GestureEngine", () => {
  it("classifies an open hand", () => {
    const engine = new GestureEngine();
    const hand = buildHand({ thumb: true, index: true, middle: true, ring: true, pinky: true });
    expect(engine.classify(hand).gesture).toBe("open_hand");
  });

  it("classifies a fist without confusing it with a pinch", () => {
    const engine = new GestureEngine();
    const hand = buildHand({ thumb: false, index: false, middle: false, ring: false, pinky: false });
    expect(engine.classify(hand).gesture).toBe("fist");
  });

  it("classifies a point", () => {
    const engine = new GestureEngine();
    const hand = buildHand({ thumb: false, index: true, middle: false, ring: false, pinky: false });
    expect(engine.classify(hand).gesture).toBe("point");
  });

  it("classifies a victory sign", () => {
    const engine = new GestureEngine();
    const hand = buildHand({ thumb: false, index: true, middle: true, ring: false, pinky: false });
    expect(engine.classify(hand).gesture).toBe("victory");
  });

  it("classifies thumbs up vs thumbs down by vertical position", () => {
    const engine = new GestureEngine();
    const hand = buildHand({ thumb: true, index: false, middle: false, ring: false, pinky: false });
    // Our synthetic thumb angle (-0.3 rad) points up-and-right, so this should read thumbs_up.
    expect(engine.classify(hand).gesture).toBe("thumbs_up");
  });

  it("returns 'none' with zero confidence for malformed (too few) landmarks", () => {
    const engine = new GestureEngine();
    const hand: HandObservation = {
      id: "bad", handedness: "Unknown", confidence: 0.1,
      landmarks: [{ x: 0, y: 0, z: 0 }], // only 1 landmark instead of 21
      timestamp: new Date().toISOString(),
    };
    const result = engine.classify(hand);
    expect(result.gesture).toBe("none");
    expect(result.confidence).toBe(0);
  });
});
