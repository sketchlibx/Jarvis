import { describe, it, expect } from "vitest";
import { PinchHysteresisTracker, SingleHandInteractionStateMachine, computeTwoHandDelta } from "../ARInteractionController";

describe("PinchHysteresisTracker — spec section 17", () => {
  it("does not flicker in the dead zone between thresholds", () => {
    const tracker = new PinchHysteresisTracker({ startThreshold: 0.045, releaseThreshold: 0.065 });
    expect(tracker.update(0.1)).toBe(false);
    expect(tracker.update(0.03)).toBe(true); // crosses start -> pinching
    expect(tracker.update(0.05)).toBe(true); // dead zone -> stays pinching
    expect(tracker.update(0.055)).toBe(true); // still dead zone
    expect(tracker.update(0.07)).toBe(false); // crosses release -> stops
    expect(tracker.update(0.05)).toBe(false); // dead zone again -> stays released
  });

  it("rejects a misconfigured hysteresis band (release <= start)", () => {
    expect(() => new PinchHysteresisTracker({ startThreshold: 0.07, releaseThreshold: 0.05 })).toThrow();
  });
});

describe("SingleHandInteractionStateMachine — spec section 20", () => {
  it("requires multiple consistent frames before entering GRABBING", () => {
    const sm = new SingleHandInteractionStateMachine(2);
    expect(sm.update(true, false)).not.toBe("GRABBING"); // frame 1
    expect(sm.update(true, false)).toBe("PINCH_START");   // frame 2
    expect(sm.update(true, false)).toBe("GRABBING");      // frame 3
  });

  it("requires multiple consistent release frames before leaving GRABBING", () => {
    const sm = new SingleHandInteractionStateMachine(2);
    sm.update(true, false); sm.update(true, false); sm.update(true, false); // now GRABBING
    expect(sm.update(false, false)).toBe("GRABBING"); // 1 release frame, not enough
    expect(sm.update(false, false)).toBe("PINCH_RELEASE"); // 2nd release frame
    expect(sm.update(false, false)).toBe("IDLE");
  });
});

describe("computeTwoHandDelta — spec sections 16, 19", () => {
  const ref = { left: { x: -0.2, y: 0, z: 0 }, right: { x: 0.2, y: 0, z: 0 } };

  it("scales up when hands move apart, down when they move together", () => {
    const farther = { left: { x: -0.4, y: 0, z: 0 }, right: { x: 0.4, y: 0, z: 0 } };
    const closer = { left: { x: -0.1, y: 0, z: 0 }, right: { x: 0.1, y: 0, z: 0 } };
    expect(computeTwoHandDelta(ref, farther).scaleMultiplier).toBeGreaterThan(1);
    expect(computeTwoHandDelta(ref, closer).scaleMultiplier).toBeLessThan(1);
  });

  it("never produces NaN or Infinity even with a degenerate reference distance", () => {
    const degenerate = { left: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 } };
    const result = computeTwoHandDelta(degenerate, ref);
    expect(Number.isFinite(result.scaleMultiplier)).toBe(true);
  });

  it("bounds extreme scale to the configured maximum", () => {
    const extreme = { left: { x: -1000, y: 0, z: 0 }, right: { x: 1000, y: 0, z: 0 } };
    const result = computeTwoHandDelta(ref, extreme);
    expect(result.scaleMultiplier).toBeLessThanOrEqual(20);
  });

  it("detects a 90-degree rotation between hands", () => {
    const rotated = { left: { x: 0, y: 0, z: -0.2 }, right: { x: 0, y: 0, z: 0.2 } };
    const result = computeTwoHandDelta(ref, rotated);
    expect(Math.abs(Math.abs(result.rotationDeltaDegrees) - 90)).toBeLessThan(1);
  });
});
