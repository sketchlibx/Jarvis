import { describe, it, expect } from "vitest";
import { serializeProject, deserializeProject } from "../serializers/ProjectSerializer";
import { DesignController } from "../commands/DesignController";

describe("Project serialization", () => {
  it("round-trips a design through serialize/deserialize", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "gauntlet", componentType: "armor_plate" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "core1", componentType: "core", parentId: "gauntlet" });

    const ser = serializeProject(ctrl.graph, "proj1", "Gauntlet Mark 1", new Date().toISOString());
    expect(ser.success).toBe(true);

    const de = deserializeProject(ser.file);
    expect(de.success).toBe(true);
    expect(de.objects).toHaveLength(2);
  });

  it("rejects an empty project name at serialization time", () => {
    const ctrl = new DesignController();
    const ser = serializeProject(ctrl.graph, "proj1", "   ", new Date().toISOString());
    expect(ser.success).toBe(false);
  });

  it("rejects a malformed project file (missing required object fields)", () => {
    const de = deserializeProject({ schemaVersion: "1.0", objects: [{ id: "x" }] });
    expect(de.success).toBe(false);
  });

  it("rejects a project file with a parentId pointing at a nonexistent object", () => {
    const de = deserializeProject({
      schemaVersion: "1.0",
      objects: [{
        id: "a", type: "box", name: "a", parentId: "ghost",
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { kind: "metal", baseColor: "#ffffff", metallic: 0, roughness: 0.5 },
        parameters: {}, metadata: {},
      }],
    });
    expect(de.success).toBe(false);
  });

  it("rejects an unsupported schema version with no migration path", () => {
    const de = deserializeProject({ schemaVersion: "0.5", objects: [] });
    expect(de.success).toBe(false);
  });

  it("rejects a non-array objects field", () => {
    const de = deserializeProject({ schemaVersion: "1.0", objects: "not an array" });
    expect(de.success).toBe(false);
  });

  it("rejects completely malformed input without throwing", () => {
    expect(() => deserializeProject(null)).not.toThrow();
    expect(() => deserializeProject("garbage")).not.toThrow();
    expect(deserializeProject(null).success).toBe(false);
  });
});
