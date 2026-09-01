import { describe, it, expect } from "vitest";
import { CoordinateMapper } from "../CoordinateMapper";

const viewport = { width: 1280, height: 720, verticalFovDegrees: 50, projectionDistance: 1 };

describe("CoordinateMapper — mirroring correctness (spec section 4)", () => {
  it("maps the frame center to world origin x/y", () => {
    const mapper = new CoordinateMapper(viewport);
    const center = mapper.mapToWorld({ x: 0.5, y: 0.5, z: 0 });
    expect(center.world.x).toBeCloseTo(0);
    expect(center.world.y).toBeCloseTo(0);
  });

  it("mirrors X so a raw-left landmark ends up on the visual right and vice versa", () => {
    const mapper = new CoordinateMapper(viewport);
    const rawLeft = mapper.mapToWorld({ x: 0.2, y: 0.5, z: 0 });
    const rawRight = mapper.mapToWorld({ x: 0.8, y: 0.5, z: 0 });
    expect(rawLeft.world.x).toBeGreaterThan(0);
    expect(rawRight.world.x).toBeLessThan(0);
  });

  it("flips Y so MediaPipe's top-of-frame (y small) maps to positive (up) world Y", () => {
    const mapper = new CoordinateMapper(viewport);
    const top = mapper.mapToWorld({ x: 0.5, y: 0.1, z: 0 });
    const bottom = mapper.mapToWorld({ x: 0.5, y: 0.9, z: 0 });
    expect(top.world.y).toBeGreaterThan(0);
    expect(bottom.world.y).toBeLessThan(0);
  });

  it("keeps the center stable after a viewport resize", () => {
    const mapper = new CoordinateMapper(viewport);
    mapper.updateViewport({ width: 1920, height: 1080 });
    const center = mapper.mapToWorld({ x: 0.5, y: 0.5, z: 0 });
    expect(center.world.x).toBeCloseTo(0);
    expect(center.world.y).toBeCloseTo(0);
  });

  it("echoes input z as estimatedDepth without fabricating precision (spec section 24)", () => {
    const mapper = new CoordinateMapper(viewport);
    const result = mapper.mapToWorld({ x: 0.5, y: 0.5, z: -0.37 });
    expect(result.estimatedDepth).toBe(-0.37);
  });
});
