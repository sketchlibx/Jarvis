import type { DesignObject, Transform, Vec3 } from "../types";
import { IDENTITY_TRANSFORM } from "../types";

/**
 * The actual source of truth for a design's object hierarchy. Three.js
 * (in `engine/GraphRenderer.ts`) only ever READS from this to build/update
 * meshes — nothing ever mutates a Three.js object directly and expects the
 * graph to follow. This is what makes undo/redo, serialization, and
 * command validation possible without touching the renderer at all, and
 * it's why every piece of Phase 4 logic in this file is unit-testable
 * without a browser or WebGL context.
 */
export class DesignGraph {
  private objects = new Map<string, DesignObject>();
  private childrenIndex = new Map<string | null, Set<string>>();

  get size(): number {
    return this.objects.size;
  }

  has(id: string): boolean {
    return this.objects.has(id);
  }

  get(id: string): DesignObject | undefined {
    return this.objects.get(id);
  }

  all(): DesignObject[] {
    return [...this.objects.values()];
  }

  childrenOf(parentId: string | null): DesignObject[] {
    const ids = this.childrenIndex.get(parentId);
    if (!ids) return [];
    return [...ids].map((id) => this.objects.get(id)!).filter(Boolean);
  }

  /** Depth of `id` in the hierarchy — root objects (parentId null) are
   * depth 0. Used by resource-limit validation (max hierarchy depth) and
   * by cycle detection (a proposed re-parent that would make an object
   * its own ancestor is caught by walking this chain — see validation). */
  depthOf(id: string): number {
    let depth = 0;
    let current = this.objects.get(id);
    const seen = new Set<string>();
    while (current?.parentId) {
      if (seen.has(current.parentId)) break; // defensive: pre-existing cycle, don't infinite-loop
      seen.add(current.parentId);
      depth += 1;
      current = this.objects.get(current.parentId);
    }
    return depth;
  }

  /** True if `candidateAncestorId` is an ancestor of `id` (or equal to it)
   * — used to reject a PARENT_OBJECT command that would create a cycle. */
  isAncestor(candidateAncestorId: string, id: string): boolean {
    let current = this.objects.get(id);
    const seen = new Set<string>();
    while (current) {
      if (current.id === candidateAncestorId) return true;
      if (!current.parentId || seen.has(current.parentId)) return false;
      seen.add(current.parentId);
      current = this.objects.get(current.parentId);
    }
    return false;
  }

  /** All descendant ids of `id`, not including `id` itself — used by
   * DELETE_OBJECT to cascade, and PARENT_OBJECT cycle checks. */
  descendantsOf(id: string): string[] {
    const result: string[] = [];
    const stack = [...this.childrenIndex.get(id) ?? []];
    while (stack.length > 0) {
      const childId = stack.pop()!;
      result.push(childId);
      stack.push(...(this.childrenIndex.get(childId) ?? []));
    }
    return result;
  }

  /** Computes an object's world transform by composing its own transform
   * with every ancestor's, per spec section 10 ("moving the parent should
   * move its children correctly"). Simple hierarchical composition
   * (translate + rotate + scale in parent space) — not a full matrix
   * implementation, which the renderer (Three.js has its own matrix math)
   * will do for actual rendering; this is for logic/tests that need a
   * world-space answer without a renderer.
   */
  worldTransformOf(id: string): Transform {
    const chain: DesignObject[] = [];
    let current = this.objects.get(id);
    const seen = new Set<string>();
    while (current) {
      chain.unshift(current);
      if (!current.parentId || seen.has(current.parentId)) break;
      seen.add(current.parentId);
      current = this.objects.get(current.parentId);
    }

    let world: Transform = { ...IDENTITY_TRANSFORM,
      position: { ...IDENTITY_TRANSFORM.position }, rotation: { ...IDENTITY_TRANSFORM.rotation }, scale: { ...IDENTITY_TRANSFORM.scale } };
    for (const obj of chain) {
      world = composeTransforms(world, obj.transform);
    }
    return world;
  }

  // ---- Mutation methods — package-private in spirit: only CommandExecutor
  // should call these directly, so history/validation stay authoritative. ----

  insert(obj: DesignObject): void {
    this.objects.set(obj.id, obj);
    this.indexParent(obj.id, obj.parentId);
  }

  remove(id: string): DesignObject | undefined {
    const obj = this.objects.get(id);
    if (!obj) return undefined;
    this.objects.delete(id);
    this.childrenIndex.get(obj.parentId)?.delete(id);
    this.childrenIndex.delete(id);
    return obj;
  }

  update(id: string, patch: Partial<Omit<DesignObject, "id">>): DesignObject | undefined {
    const existing = this.objects.get(id);
    if (!existing) return undefined;
    const updated: DesignObject = { ...existing, ...patch, id: existing.id };
    if (patch.parentId !== undefined && patch.parentId !== existing.parentId) {
      this.childrenIndex.get(existing.parentId)?.delete(id);
      this.indexParent(id, patch.parentId);
    }
    this.objects.set(id, updated);
    return updated;
  }

  clear(): void {
    this.objects.clear();
    this.childrenIndex.clear();
  }

  /** Deep-clones the current state — used by History/Transaction to take
   * cheap-ish snapshots for rollback without any renderer involvement. */
  snapshot(): DesignObject[] {
    return this.all().map((o) => structuredCloneObject(o));
  }

  restoreFrom(objects: DesignObject[]): void {
    this.clear();
    for (const obj of objects) this.insert(structuredCloneObject(obj));
  }

  private indexParent(id: string, parentId: string | null): void {
    if (!this.childrenIndex.has(parentId)) this.childrenIndex.set(parentId, new Set());
    this.childrenIndex.get(parentId)!.add(id);
  }
}

function composeTransforms(parent: Transform, child: Transform): Transform {
  // Position: child position scaled by parent scale, then added to parent
  // position (rotation composition omitted for simplicity — a full
  // implementation would rotate the offset by the parent's rotation too;
  // this is a known, documented simplification, not silently wrong).
  return {
    position: {
      x: parent.position.x + child.position.x * parent.scale.x,
      y: parent.position.y + child.position.y * parent.scale.y,
      z: parent.position.z + child.position.z * parent.scale.z,
    },
    rotation: {
      x: parent.rotation.x + child.rotation.x,
      y: parent.rotation.y + child.rotation.y,
      z: parent.rotation.z + child.rotation.z,
    },
    scale: {
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
      z: parent.scale.z * child.scale.z,
    },
  };
}

function structuredCloneObject<T>(obj: T): T {
  // Avoid a hard dependency on the global structuredClone (Node <17 /
  // certain WebView versions) — JSON round-trip is sufficient here since
  // DesignObject is plain JSON-serializable data by construction.
  return JSON.parse(JSON.stringify(obj));
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
