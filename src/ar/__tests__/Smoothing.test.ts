import { describe, it, expect } from "vitest";
import { ExponentialSmoother, OneEuroVec3Filter, QuaternionSmoother } from "../Smoothing";

describe("ExponentialSmoother", () => {
  it("reduces variance on jittery input around a stable value", () => {
    const smoother = new ExponentialSmoother(0.3);
    const jittery = [0.5, 0.52, 0.48, 0.51, 0.49, 0.53, 0.47, 0.5];
    const outputs = jittery.map((v) => smoother.smooth({ x: v, y: 0, z: 0 }).x);
    const variance = (arr: number[]) => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
    };
    expect(variance(outputs)).toBeLessThan(variance(jittery));
  });

  it("rejects an out-of-range factor via the constructor", () => {
    expect(() => new ExponentialSmoother(0)).toThrow();
    expect(() => new ExponentialSmoother(1.5)).toThrow();
  });
});

describe("OneEuroVec3Filter", () => {
  it("passes the first value through without lag", () => {
    const filter = new OneEuroVec3Filter();
    const first = filter.filter({ x: 1, y: 2, z: 3 }, 0);
    expect(first).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("moves toward a sudden target rather than staying stuck", () => {
    const filter = new OneEuroVec3Filter();
    let t = 0;
    for (let i = 0; i < 10; i++) { filter.filter({ x: 0, y: 0, z: 0 }, t); t += 16; }
    const jump = filter.filter({ x: 1, y: 0, z: 0 }, t);
    expect(jump.x).toBeGreaterThan(0);
  });
});

describe("QuaternionSmoother", () => {
  it("keeps the slerped result normalized", () => {
    const smoother = new QuaternionSmoother(0.5);
    smoother.smooth({ x: 0, y: 0, z: 0, w: 1 });
    const result = smoother.smooth({ x: 0.7071, y: 0, z: 0, w: 0.7071 });
    const len = Math.sqrt(result.x ** 2 + result.y ** 2 + result.z ** 2 + result.w ** 2);
    expect(len).toBeCloseTo(1, 5);
  });
});
