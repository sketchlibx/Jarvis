import type { Vec3 } from "../design3d/types";
import type { Quaternion } from "./types";

/**
 * Simple exponential smoothing — the default, spec section 13's "good
 * balance between stability and responsiveness" starting point. Higher
 * `factor` = more responsive/less smoothed; lower = smoother/more laggy.
 */
export class ExponentialSmoother {
  private current: Vec3 | null = null;

  constructor(private factor: number = 0.35) {
    if (factor <= 0 || factor > 1) throw new Error("smoothing factor must be within (0, 1]");
  }

  setFactor(factor: number): void {
    if (factor <= 0 || factor > 1) return; // reject silently — caller should validate via ARCalibration validation before this point
    this.factor = factor;
  }

  smooth(target: Vec3): Vec3 {
    if (!this.current) {
      this.current = { ...target };
      return this.current;
    }
    this.current = {
      x: this.current.x + (target.x - this.current.x) * this.factor,
      y: this.current.y + (target.y - this.current.y) * this.factor,
      z: this.current.z + (target.z - this.current.z) * this.factor,
    };
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}

/**
 * One Euro filter — adapts its smoothing based on estimated velocity, so
 * slow/held-still hands get heavy smoothing (less jitter) while fast
 * movement gets light smoothing (less lag). Real, standard algorithm
 * (Casiez et al. 2012), not a simplification pretending to be one.
 */
export class OneEuroFilter {
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastValue: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(
    private minCutoff: number = 1.0,
    private beta: number = 0.3,
    private dCutoff: number = 1.0
  ) {}

  filter(value: number, timestampMs: number): number {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs;
      this.lastValue = value;
      this.xFilter.reset(value);
      return value;
    }
    const dt = Math.max((timestampMs - this.lastTimestamp) / 1000, 1 / 240); // clamp to avoid divide-by-zero on duplicate timestamps
    this.lastTimestamp = timestampMs;

    const dValue = (value - (this.lastValue ?? value)) / dt;
    const alphaD = smoothingAlpha(this.dCutoff, dt);
    const smoothedDValue = this.dxFilter.filter(dValue, alphaD);

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDValue);
    const alpha = smoothingAlpha(cutoff, dt);
    const result = this.xFilter.filter(value, alpha);

    this.lastValue = value;
    return result;
  }

  reset(): void {
    this.lastValue = null;
    this.lastTimestamp = null;
  }
}

function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPassFilter {
  private y: number | null = null;
  filter(value: number, alpha: number): number {
    if (this.y === null) { this.y = value; return value; }
    this.y = alpha * value + (1 - alpha) * this.y;
    return this.y;
  }
  reset(value: number): void {
    this.y = value;
  }
}

/** Vec3-wrapped OneEuroFilter, since anchor positions are 3D. */
export class OneEuroVec3Filter {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private fz: OneEuroFilter;

  constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fz = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(value: Vec3, timestampMs: number): Vec3 {
    return {
      x: this.fx.filter(value.x, timestampMs),
      y: this.fy.filter(value.y, timestampMs),
      z: this.fz.filter(value.z, timestampMs),
    };
  }

  reset(): void {
    this.fx.reset(); this.fy.reset(); this.fz.reset();
  }
}

/** Spherical-linear-interpolation-based smoothing for quaternions — simple
 * exponential smoothing on raw quaternion components does NOT produce a
 * valid rotation in general (the result must be re-normalized, and slerp
 * is the geometrically correct way to blend two orientations). */
export class QuaternionSmoother {
  private current: Quaternion | null = null;
  constructor(private factor: number = 0.35) {}

  smooth(target: Quaternion): Quaternion {
    if (!this.current) {
      this.current = target;
      return target;
    }
    this.current = slerp(this.current, target, this.factor);
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}

function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let { x: bx, y: by, z: bz, w: bw } = b;
  let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;

  // Take the shorter path around the hypersphere.
  if (dot < 0) {
    dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  if (dot > 0.9995) {
    // Nearly identical — linear interpolation is numerically safer than
    // slerp's division-by-near-zero-sin here, and visually indistinguishable.
    return normalizeQ({
      x: a.x + t * (bx - a.x), y: a.y + t * (by - a.y),
      z: a.z + t * (bz - a.z), w: a.w + t * (bw - a.w),
    });
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const sinTheta = Math.sin(theta);
  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return normalizeQ({
    x: s0 * a.x + s1 * bx, y: s0 * a.y + s1 * by,
    z: s0 * a.z + s1 * bz, w: s0 * a.w + s1 * bw,
  });
}

function normalizeQ(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}
