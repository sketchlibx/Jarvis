import { describe, it, expect } from "vitest";
import { validateCommand } from "../commands/validation";
import { DesignGraph } from "../scene/DesignGraph";
import { DEFAULT_RESOURCE_LIMITS } from "../types";

/**
 * These tests reproduce the spec's explicit adversarial examples from
 * sections 13, 36, and 37. Their logic was verified once already via a
 * standalone `node` harness during development (27 checks, all passing —
 * see repo dev notes) before being written as this vitest file.
 */
describe("validateCommand — spec section 13/36/37 adversarial cases", () => {
  const graph = () => new DesignGraph();
  const limits = DEFAULT_RESOURCE_LIMITS;

  it("rejects scale = Infinity", () => {
    const g = graph();
    g.insert({ id: "obj1", type: "box", name: "obj1", parentId: null, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: { kind: "metal", baseColor: "#ffffff", metallic: 0, roughness: 0.5 }, parameters: {}, metadata: {} });
    const result = validateCommand({ type: "SCALE_OBJECT", objectId: "obj1", scale: { x: Infinity, y: 1, z: 1 } }, g, limits);
    expect(result.valid).toBe(false);
  });

  it("rejects scale = NaN", () => {
    const g = graph();
    g.insert({ id: "obj1", type: "box", name: "obj1", parentId: null, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: { kind: "metal", baseColor: "#ffffff", metallic: 0, roughness: 0.5 }, parameters: {}, metadata: {} });
    const result = validateCommand({ type: "SCALE_OBJECT", objectId: "obj1", scale: { x: NaN, y: 1, z: 1 } }, g, limits);
    expect(result.valid).toBe(false);
  });

  it("rejects componentType = 'execute-code'", () => {
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "x", componentType: "execute-code" }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("rejects a command shaped like { command: 'executeJavascript' }", () => {
    const result = validateCommand({ command: "executeJavascript" }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("rejects a path-traversal-shaped componentType", () => {
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "x", componentType: "../../../.." }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("rejects a path-traversal-shaped objectId", () => {
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "../../../..", componentType: "box" }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("rejects an unknown command type outright", () => {
    const result = validateCommand({ type: "DELETE_C_DRIVE", objectId: "x" }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("enforces the object count limit", () => {
    const g = graph();
    const tightLimits = { ...limits, maxObjects: 1 };
    g.insert({ id: "o1", type: "box", name: "o1", parentId: null, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: { kind: "metal", baseColor: "#ffffff", metallic: 0, roughness: 0.5 }, parameters: {}, metadata: {} });
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "o2", componentType: "box" }, g, tightLimits);
    expect(result.valid).toBe(false);
  });

  it("rejects a parameter value outside its component's valid range", () => {
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "e1", componentType: "emitter", parameters: { radius: -5 } }, graph(), limits);
    expect(result.valid).toBe(false);
  });

  it("rejects an unexpected parameter key riding along with a legitimate command", () => {
    const result = validateCommand({ type: "CREATE_OBJECT", objectId: "e1", componentType: "emitter", parameters: { radius: 0.03, code: "alert(1)" } }, graph(), limits);
    expect(result.valid).toBe(false);
  });
});
