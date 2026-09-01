import { describe, it, expect } from "vitest";
import { DesignController } from "../commands/DesignController";
import { DEFAULT_RESOURCE_LIMITS } from "../types";

describe("DesignController — undo/redo", () => {
  it("undo removes a created object, redo restores it", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "o1", componentType: "box" });
    expect(ctrl.graph.has("o1")).toBe(true);
    ctrl.undo();
    expect(ctrl.graph.has("o1")).toBe(false);
    ctrl.redo();
    expect(ctrl.graph.has("o1")).toBe(true);
  });

  it("undoMultiple undoes exactly the requested count, or fewer if history runs out", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "o1", componentType: "box" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "o2", componentType: "box" });
    const undone = ctrl.undoMultiple(5); // only 2 exist
    expect(undone).toBe(2);
    expect(ctrl.graph.size).toBe(0);
  });
});

describe("DesignController — transactions", () => {
  it("rolls back completely when a step in the middle fails", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "existing", componentType: "box" });
    const sizeBefore = ctrl.graph.size;

    const result = ctrl.applyTransaction([
      { type: "CREATE_OBJECT", objectId: "chest", componentType: "armor_plate" },
      { type: "CREATE_OBJECT", objectId: "core", componentType: "core" },
      { type: "CREATE_OBJECT", objectId: "existing", componentType: "box" }, // id collision -> fails
      { type: "CREATE_OBJECT", objectId: "emitter1", componentType: "emitter" },
    ]);

    expect(result.success).toBe(false);
    expect(result.failedStep?.index).toBe(2);
    expect(ctrl.graph.size).toBe(sizeBefore); // no partial state survives
    expect(ctrl.graph.has("chest")).toBe(false);
    expect(ctrl.graph.has("core")).toBe(false);
  });

  it("a successful transaction is undone as a single unit", () => {
    const ctrl = new DesignController();
    const result = ctrl.applyTransaction([
      { type: "CREATE_OBJECT", objectId: "chestplate", componentType: "armor_plate" },
      { type: "CREATE_OBJECT", objectId: "core1", componentType: "core", parentId: "chestplate" },
      { type: "CREATE_OBJECT", objectId: "em1", componentType: "emitter", parentId: "chestplate" },
    ]);
    expect(result.success).toBe(true);
    expect(ctrl.graph.size).toBe(3);
    ctrl.undo();
    expect(ctrl.graph.size).toBe(0);
  });
});

describe("DesignController — hierarchy integrity", () => {
  it("rejects a re-parent that would create a cycle", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "a", componentType: "box" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "b", componentType: "box", parentId: "a" });
    const result = ctrl.apply({ type: "PARENT_OBJECT", objectId: "a", newParentId: "b" });
    expect(result.success).toBe(false);
  });

  it("moving a parent moves its children's world transform", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "parent", componentType: "box" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "child", componentType: "box", parentId: "parent" });
    ctrl.apply({ type: "MOVE_OBJECT", objectId: "parent", position: { x: 5, y: 0, z: 0 } });
    const world = ctrl.graph.worldTransformOf("child");
    expect(world.position.x).toBe(5);
  });

  it("deleting a parent cascades to its children", () => {
    const ctrl = new DesignController();
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "parent", componentType: "box" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "child", componentType: "box", parentId: "parent" });
    ctrl.apply({ type: "DELETE_OBJECT", objectId: "parent" });
    expect(ctrl.graph.has("parent")).toBe(false);
    expect(ctrl.graph.has("child")).toBe(false);
  });

  it("enforces max hierarchy depth", () => {
    const ctrl = new DesignController({ ...DEFAULT_RESOURCE_LIMITS, maxHierarchyDepth: 2 });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "root", componentType: "box" });
    ctrl.apply({ type: "CREATE_OBJECT", objectId: "child1", componentType: "box", parentId: "root" });
    const result = ctrl.apply({ type: "CREATE_OBJECT", objectId: "child2", componentType: "box", parentId: "child1" });
    expect(result.success).toBe(false);
  });
});
