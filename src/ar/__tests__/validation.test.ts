import { describe, it, expect } from "vitest";
import { validateARCommand } from "../validation";
import { validateCalibration, deserializeCalibration, resetCalibration } from "../Calibration";
import { DEFAULT_CALIBRATION } from "../types";

describe("validateARCommand", () => {
  const instanceIds = new Set(["inst1"]);
  const designIds = new Set(["gauntlet1"]);

  it("accepts a well-formed ATTACH_AR_OBJECT", () => {
    const result = validateARCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst2", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" }, instanceIds, designIds);
    expect(result.valid).toBe(true);
  });

  it("rejects attaching to a designObjectId that doesn't exist", () => {
    const result = validateARCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst2", designObjectId: "ghost", anchorType: "HAND_WRIST" }, instanceIds, designIds);
    expect(result.valid).toBe(false);
  });

  it("rejects a duplicate instanceId", () => {
    const result = validateARCommand({ type: "ATTACH_AR_OBJECT", instanceId: "inst1", designObjectId: "gauntlet1", anchorType: "HAND_WRIST" }, instanceIds, designIds);
    expect(result.valid).toBe(false);
  });

  it("rejects an unknown command type", () => {
    const result = validateARCommand({ type: "EXECUTE_SHELL", instanceId: "inst1" }, instanceIds, designIds);
    expect(result.valid).toBe(false);
  });

  it("rejects SET_AR_SCALE with Infinity, NaN, or negative values", () => {
    for (const bad of [Infinity, NaN, -5]) {
      const result = validateARCommand({ type: "SET_AR_SCALE", instanceId: "inst1", scaleMultiplier: bad }, instanceIds, designIds);
      expect(result.valid).toBe(false);
    }
  });

  it("accepts SET_AR_SCALE within bounds", () => {
    const result = validateARCommand({ type: "SET_AR_SCALE", instanceId: "inst1", scaleMultiplier: 2.5 }, instanceIds, designIds);
    expect(result.valid).toBe(true);
  });

  it("rejects a path-traversal-shaped instanceId", () => {
    const result = validateARCommand({ type: "DETACH_AR_OBJECT", instanceId: "../../etc" }, instanceIds, designIds);
    expect(result.valid).toBe(false);
  });

  it("rejects an unsupported anchor type", () => {
    const result = validateARCommand({ type: "SET_AR_ANCHOR", instanceId: "inst1", anchorType: "CHAKRA" }, instanceIds, designIds);
    expect(result.valid).toBe(false);
  });
});

describe("AR Calibration", () => {
  it("validates the default calibration", () => {
    expect(validateCalibration(DEFAULT_CALIBRATION).valid).toBe(true);
  });

  it("rejects an out-of-range smoothingFactor", () => {
    expect(validateCalibration({ ...DEFAULT_CALIBRATION, smoothingFactor: 5 }).valid).toBe(false);
  });

  it("rejects a NaN objectSizeMultiplier", () => {
    expect(validateCalibration({ ...DEFAULT_CALIBRATION, objectSizeMultiplier: NaN }).valid).toBe(false);
  });

  it("rejects an unsupported schema version with no migration path", () => {
    const result = deserializeCalibration({ schemaVersion: "99.0" });
    expect(result.success).toBe(false);
  });

  it("resetCalibration always returns a valid calibration", () => {
    expect(validateCalibration(resetCalibration()).valid).toBe(true);
  });
});
