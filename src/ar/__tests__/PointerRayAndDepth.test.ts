import { describe, it, expect } from "vitest";
import { estimatePointerRay } from "../PointerRayEstimator";
import { CoordinateMapper } from "../CoordinateMapper";
import { NoDepthProvider, MonocularDepthProvider } from "../DepthProvider";
import type { HandObservation, Landmark } from "../../types/perception";

const viewport = { width: 1280, height: 720, verticalFovDegrees: 50, projectionDistance: 1 };

describe("estimatePointerRay — spec section 22", () => {
  it("produces a normalized direction vector for a well-formed pointing hand", () => {
    const mapper = new CoordinateMapper(viewport);
    const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    lm[5] = { x: 0.5, y: 0.5, z: 0 };
    lm[6] = { x: 0.55, y: 0.4, z: -0.05 };
    lm[8] = { x: 0.6, y: 0.3, z: -0.1 };
    const hand: HandObservation = { id: "h1", handedness: "Right", confidence: 0.9, landmarks: lm, timestamp: "t" };

    const ray = estimatePointerRay(hand, mapper);
    expect(ray).not.toBeNull();
    const len = Math.sqrt(ray!.direction.x ** 2 + ray!.direction.y ** 2 + ray!.direction.z ** 2);
    expect(len).toBeCloseTo(1, 5);
  });

  it("returns null when the index finger landmarks are missing", () => {
    const mapper = new CoordinateMapper(viewport);
    const hand: HandObservation = { id: "h1", handedness: "Right", confidence: 0.5, landmarks: [], timestamp: "t" };
    expect(estimatePointerRay(hand, mapper)).toBeNull();
  });

  it("returns null for a degenerate hand where MCP and tip coincide", () => {
    const mapper = new CoordinateMapper(viewport);
    const lm: Landmark[] = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    const hand: HandObservation = { id: "h1", handedness: "Right", confidence: 0.9, landmarks: lm, timestamp: "t" };
    expect(estimatePointerRay(hand, mapper)).toBeNull();
  });
});

describe("Depth providers — spec sections 24, 25 (never fabricate depth)", () => {
  it("NoDepthProvider reports unavailable and non-metric, never returns a value", () => {
    const provider = new NoDepthProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getCapabilities().metric).toBe(false);
    expect(provider.getDepth(0.5, 0.5)).toBeNull();
  });

  it("MonocularDepthProvider explicitly reports non-metric capabilities", () => {
    const provider = new MonocularDepthProvider();
    expect(provider.getCapabilities().metric).toBe(false);
    expect(provider.getCapabilities().relative).toBe(true);
  });

  it("MonocularDepthProvider returns null before any data is recorded, never a fabricated default", () => {
    const provider = new MonocularDepthProvider();
    expect(provider.getDepth(0.5, 0.5)).toBeNull();
  });

  it("MonocularDepthProvider returns exactly the recorded value", () => {
    const provider = new MonocularDepthProvider();
    provider.record(0.5, 0.5, -0.2);
    expect(provider.getDepth(0.5, 0.5)).toBe(-0.2);
  });
});
