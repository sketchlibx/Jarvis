import type { ComponentParameters, DesignCommand, DesignObject, MaterialSpec, ResourceLimits, Transform } from "../types";
import { IDENTITY_TRANSFORM } from "../types";
import { DesignGraph } from "../scene/DesignGraph";
import { validateCommand } from "./validation";

const DEFAULT_MATERIAL: MaterialSpec = { kind: "matte_metal", baseColor: "#8a94a3", metallic: 0.4, roughness: 0.6 };

export interface ExecutionError {
  command: DesignCommand;
  errors: string[];
}

export type ExecutionResult =
  | { success: true; undo: () => void }
  | { success: false; errors: string[] };

/**
 * Applies ONE validated command to a DesignGraph. Every command's
 * application here also builds its own inverse (`undo`) closure over a
 * snapshot of only what that command touched — not a full-graph snapshot
 * per command, which would be wasteful for large designs. `history/History.ts`
 * is what actually calls and stacks these.
 *
 * This function re-validates internally (cheap, and defends against a
 * caller skipping `validateCommand` — never trust that validation already
 * happened upstream for something this consequential).
 */
export function executeCommand(graph: DesignGraph, cmd: DesignCommand, limits: ResourceLimits): ExecutionResult {
  const validation = validateCommand(cmd, graph, limits);
  if (!validation.valid) return { success: false, errors: validation.errors };

  switch (cmd.type) {
    case "CREATE_OBJECT": {
      const obj: DesignObject = {
        id: cmd.objectId,
        type: cmd.componentType,
        name: cmd.objectId,
        parentId: cmd.parentId ?? null,
        transform: mergeTransform(IDENTITY_TRANSFORM, cmd.transform),
        material: mergeMaterial(DEFAULT_MATERIAL, cmd.material),
        parameters: cmd.parameters ?? {},
        metadata: {},
      };
      graph.insert(obj);
      return { success: true, undo: () => { graph.remove(obj.id); } };
    }

    case "DELETE_OBJECT": {
      const toDelete = [cmd.objectId, ...graph.descendantsOf(cmd.objectId)];
      const removed = toDelete.map((id) => graph.get(id)!).filter(Boolean);
      for (const id of toDelete) graph.remove(id);
      return { success: true, undo: () => { for (const obj of removed) graph.insert(obj); } };
    }

    case "UPDATE_OBJECT":
    case "ADD_COMPONENT": {
      const existing = graph.get(cmd.objectId)!;
      const prevParams = { ...existing.parameters };
      const nextParams: ComponentParameters = { ...existing.parameters, ...(cmd.type === "UPDATE_OBJECT" ? cmd.parameters : cmd.parameters ?? {}) };
      graph.update(cmd.objectId, { parameters: nextParams });
      return { success: true, undo: () => { graph.update(cmd.objectId, { parameters: prevParams }); } };
    }

    case "REMOVE_COMPONENT": {
      const existing = graph.get(cmd.objectId)!;
      const prevParams = { ...existing.parameters };
      graph.update(cmd.objectId, { parameters: {} });
      return { success: true, undo: () => { graph.update(cmd.objectId, { parameters: prevParams }); } };
    }

    case "MOVE_OBJECT": {
      const existing = graph.get(cmd.objectId)!;
      const prevPosition = { ...existing.transform.position };
      graph.update(cmd.objectId, { transform: { ...existing.transform, position: cmd.position } });
      return { success: true, undo: () => { const e = graph.get(cmd.objectId)!; graph.update(cmd.objectId, { transform: { ...e.transform, position: prevPosition } }); } };
    }
    case "ROTATE_OBJECT": {
      const existing = graph.get(cmd.objectId)!;
      const prevRotation = { ...existing.transform.rotation };
      graph.update(cmd.objectId, { transform: { ...existing.transform, rotation: cmd.rotation } });
      return { success: true, undo: () => { const e = graph.get(cmd.objectId)!; graph.update(cmd.objectId, { transform: { ...e.transform, rotation: prevRotation } }); } };
    }
    case "SCALE_OBJECT": {
      const existing = graph.get(cmd.objectId)!;
      const prevScale = { ...existing.transform.scale };
      graph.update(cmd.objectId, { transform: { ...existing.transform, scale: cmd.scale } });
      return { success: true, undo: () => { const e = graph.get(cmd.objectId)!; graph.update(cmd.objectId, { transform: { ...e.transform, scale: prevScale } }); } };
    }

    case "SET_MATERIAL": {
      const existing = graph.get(cmd.objectId)!;
      const prevMaterial = { ...existing.material };
      graph.update(cmd.objectId, { material: mergeMaterial(existing.material, cmd.material) });
      return { success: true, undo: () => { graph.update(cmd.objectId, { material: prevMaterial }); } };
    }
    case "SET_COLOR": {
      const existing = graph.get(cmd.objectId)!;
      const prevColor = existing.material.baseColor;
      graph.update(cmd.objectId, { material: { ...existing.material, baseColor: cmd.color } });
      return { success: true, undo: () => { const e = graph.get(cmd.objectId)!; graph.update(cmd.objectId, { material: { ...e.material, baseColor: prevColor } }); } };
    }

    case "PARENT_OBJECT": {
      const existing = graph.get(cmd.objectId)!;
      const prevParentId = existing.parentId;
      graph.update(cmd.objectId, { parentId: cmd.newParentId });
      return { success: true, undo: () => { graph.update(cmd.objectId, { parentId: prevParentId }); } };
    }

    case "DUPLICATE_OBJECT": {
      const existing = graph.get(cmd.objectId)!;
      const copy: DesignObject = { ...JSON.parse(JSON.stringify(existing)), id: cmd.newObjectId, name: `${existing.name} copy` };
      graph.insert(copy);
      return { success: true, undo: () => { graph.remove(copy.id); } };
    }

    case "SAVE_PROJECT":
    case "LOAD_PROJECT":
      // Handled by design3d/projects — not a graph mutation, so nothing to
      // undo at this layer. Reaching here means CommandExecutor was asked
      // to apply a persistence command directly, which the higher-level
      // ProjectController should intercept before it ever gets here.
      return { success: false, errors: [`${cmd.type} must be handled by the project controller, not CommandExecutor`] };

    default:
      return { success: false, errors: [`unhandled command type`] };
  }
}

function mergeTransform(base: Transform, patch?: Partial<Transform>): Transform {
  if (!patch) return { position: { ...base.position }, rotation: { ...base.rotation }, scale: { ...base.scale } };
  return {
    position: { ...base.position, ...patch.position },
    rotation: { ...base.rotation, ...patch.rotation },
    scale: { ...base.scale, ...patch.scale },
  };
}

function mergeMaterial(base: MaterialSpec, patch?: Partial<MaterialSpec>): MaterialSpec {
  return { ...base, ...patch };
}
