import * as THREE from "three";
import type { ComponentType, DesignObject, MaterialSpec } from "../types";
import type { DesignGraph } from "../scene/DesignGraph";

/**
 * Minimal shape GraphRenderer actually needs from its host — loosened from
 * a hard `SceneManager` dependency (spec Phase 5 section 1: "if an
 * existing abstraction is insufficient, extend it instead of replacing
 * it") so `ARScene` can reuse GraphRenderer's mesh-building logic without
 * instantiating a full second `SceneManager` (with its own renderer/
 * controls/lights it would never use). Any real `SceneManager` already
 * satisfies this shape structurally — no call site needs to change.
 */
export interface GraphRendererHost {
  scene: THREE.Scene;
}

/**
 * # Status: UNVERIFIED (no WebGL context available in this sandbox).
 *
 * Reads DesignGraph state and creates/updates/removes matching Three.js
 * Object3D instances in the SceneManager's scene. This is intentionally
 * one-directional: nothing in this class ever writes back into DesignGraph
 * — the graph is authoritative, this is a projection of it. That's what
 * keeps undo/redo, serialization, and validation entirely independent of
 * whether a renderer even exists (see design3d/__tests__ — none of them
 * import this file or touch WebGL).
 *
 * Geometry generation (`createGeometryFor`) implements the procedural
 * component library from spec section 8/9 using Three.js's built-in
 * geometry primitives — composed/parameterized, not a mesh-generation ML
 * model, per spec section 39's explicit honesty requirement.
 */
export class GraphRenderer {
  private meshes = new Map<string, THREE.Object3D>();
  private selectedId: string | null = null;
  private selectionOutline: THREE.Mesh | null = null;

  constructor(private host: GraphRendererHost) {}

  /** Full re-sync: walks the graph and creates/updates/removes meshes to
   * match. Called after every command (not on every render frame) —
   * cheap enough for the object counts Phase 4's resource limits allow
   * (≤500 by default), and much simpler to reason about than a granular
   * diffing system for a first implementation. */
  syncFromGraph(graph: DesignGraph): void {
    const currentIds = new Set(graph.all().map((o) => o.id));

    for (const [id, obj3d] of this.meshes) {
      if (!currentIds.has(id)) {
        this.removeObject(id, obj3d);
      }
    }

    for (const obj of graph.all()) {
      const existing = this.meshes.get(obj.id);
      if (existing) {
        this.updateObject(existing, obj);
      } else {
        const created = this.createObject(obj);
        this.meshes.set(obj.id, created);
        this.host.scene.add(created);
      }
    }

    // Re-parent pass — must happen after all objects exist, since a
    // child's Three.js parent might be created after the child in graph
    // iteration order.
    for (const obj of graph.all()) {
      const mesh = this.meshes.get(obj.id)!;
      const desiredParent = obj.parentId ? this.meshes.get(obj.parentId) : this.host.scene;
      if (desiredParent && mesh.parent !== desiredParent) {
        desiredParent.add(mesh);
      }
    }
  }

  /** Read-only access to a design object's live Three.js node, keyed by
   * DesignObject id — used by `ARScene` to re-parent an existing mesh
   * under an AR anchor group without GraphRenderer needing to know
   * anything about AR at all (one-directional reuse, no coupling back). */
  getObject3D(designObjectId: string): THREE.Object3D | undefined {
    return this.meshes.get(designObjectId);
  }

  select(id: string | null): void {
    if (this.selectionOutline) {
      this.selectionOutline.parent?.remove(this.selectionOutline);
      this.selectionOutline.geometry.dispose();
      (this.selectionOutline.material as THREE.Material).dispose();
      this.selectionOutline = null;
    }
    this.selectedId = id;
    if (!id) return;
    const mesh = this.meshes.get(id);
    if (!mesh || !(mesh instanceof THREE.Mesh)) return;

    const outlineGeo = mesh.geometry.clone();
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x4ee1ff, wireframe: true, transparent: true, opacity: 0.6 });
    const outline = new THREE.Mesh(outlineGeo, outlineMat);
    outline.scale.multiplyScalar(1.03);
    mesh.add(outline);
    this.selectionOutline = outline;
  }

  raycastSelect(camera: THREE.Camera, ndcX: number, ndcY: number): string | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const targets = [...this.meshes.values()].filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    for (const [id, obj] of this.meshes) {
      if (obj === hits[0].object) return id;
    }
    return null;
  }

  private createObject(obj: DesignObject): THREE.Object3D {
    const geometry = createGeometryFor(obj.type, obj.parameters);
    const material = createMaterial(obj.material);
    const mesh = new THREE.Mesh(geometry, material);
    applyTransform(mesh, obj);
    mesh.name = obj.id;
    return mesh;
  }

  private updateObject(obj3d: THREE.Object3D, obj: DesignObject): void {
    applyTransform(obj3d, obj);
    if (obj3d instanceof THREE.Mesh) {
      // Geometry parameters can change (e.g. "make the wrist thinner") —
      // rebuild rather than mutate in place, since Three.js buffer
      // geometries aren't designed for live parameter edits.
      const newGeometry = createGeometryFor(obj.type, obj.parameters);
      obj3d.geometry.dispose();
      obj3d.geometry = newGeometry;

      const mat = obj3d.material as THREE.MeshPhysicalMaterial;
      applyMaterialInPlace(mat, obj.material);
    }
  }

  private removeObject(id: string, obj3d: THREE.Object3D): void {
    obj3d.parent?.remove(obj3d);
    if (obj3d instanceof THREE.Mesh) {
      obj3d.geometry.dispose();
      const mats = Array.isArray(obj3d.material) ? obj3d.material : [obj3d.material];
      for (const m of mats) m.dispose();
    }
    this.meshes.delete(id);
    if (this.selectedId === id) this.select(null);
  }

  /** Full teardown of every mesh this renderer created — called alongside
   * SceneManager.dispose() when the Design Studio closes. */
  dispose(): void {
    for (const [id, obj3d] of [...this.meshes]) {
      this.removeObject(id, obj3d);
    }
  }
}

function applyTransform(obj3d: THREE.Object3D, obj: DesignObject): void {
  obj3d.position.set(obj.transform.position.x, obj.transform.position.y, obj.transform.position.z);
  obj3d.rotation.set(
    THREE.MathUtils.degToRad(obj.transform.rotation.x),
    THREE.MathUtils.degToRad(obj.transform.rotation.y),
    THREE.MathUtils.degToRad(obj.transform.rotation.z)
  );
  obj3d.scale.set(obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z);
}

/** Procedural geometry per component type — composed from Three.js's
 * built-in primitives (BoxGeometry, CylinderGeometry, etc), parameterized
 * by validated ComponentParameters. This is the honest boundary spec
 * section 39 asks for: these are assembled shapes, not a generative mesh
 * model producing novel topology. */
function createGeometryFor(type: ComponentType, params: Record<string, number | string | boolean>): THREE.BufferGeometry {
  const num = (key: string, fallback: number) => (typeof params[key] === "number" ? (params[key] as number) : fallback);

  switch (type) {
    case "box":
      return new THREE.BoxGeometry(num("width", 0.2), num("height", 0.2), num("depth", 0.2));
    case "cylinder":
      return new THREE.CylinderGeometry(num("radius", 0.1), num("radius", 0.1), num("height", 0.3), Math.round(num("segments", 24)));
    case "sphere":
      return new THREE.SphereGeometry(num("radius", 0.1), Math.round(num("segments", 24)), Math.round(num("segments", 24)));
    case "cone":
      return new THREE.ConeGeometry(num("radius", 0.1), num("height", 0.2), Math.round(num("segments", 24)));
    case "capsule":
      return new THREE.CapsuleGeometry(num("radius", 0.06), num("length", 0.3), 4, 12);
    case "ring":
      return new THREE.RingGeometry(num("innerRadius", 0.08), num("outerRadius", 0.1), Math.round(num("segments", 32)));
    case "tube": {
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.1, 0, 0), new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0.1, 0, 0)]);
      return new THREE.TubeGeometry(path, 20, num("thickness", 0.01), 8, false);
    }
    case "panel":
    case "bevelled_panel":
    case "armor_plate":
      // Bevel is approximated with a simple box for now — a true bevel
      // needs an extruded/rounded geometry, a reasonable follow-up rather
      // than a Phase 4 blocker.
      return new THREE.BoxGeometry(num("width", 0.3), num("height", 0.2), num("thickness", num("depth", 0.01)));
    case "connector":
    case "handle":
      return new THREE.CylinderGeometry(num("radius", 0.02), num("radius", 0.02), num("length", 0.1), 12);
    case "joint":
      return new THREE.SphereGeometry(num("radius", 0.03), 16, 16);
    case "hinge":
      return new THREE.CylinderGeometry(num("radius", 0.015), num("radius", 0.015), num("length", 0.08), 12);
    case "emitter":
    case "core":
    case "lens":
      return new THREE.SphereGeometry(num("radius", 0.03), 20, 20);
    case "vent":
    case "grille":
      return new THREE.BoxGeometry(num("width", 0.12), num("height", 0.06), 0.01);
    case "mount":
      return new THREE.BoxGeometry(num("width", 0.05), num("height", 0.05), num("depth", 0.03));
    default:
      return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
}

function createMaterial(spec: MaterialSpec): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.baseColor),
    metalness: spec.metallic,
    roughness: spec.roughness,
  });
  applyMaterialInPlace(mat, spec);
  return mat;
}

function applyMaterialInPlace(mat: THREE.MeshPhysicalMaterial, spec: MaterialSpec): void {
  mat.color.set(spec.baseColor);
  mat.metalness = spec.metallic;
  mat.roughness = spec.roughness;
  if (spec.emissiveColor) {
    mat.emissive.set(spec.emissiveColor);
    mat.emissiveIntensity = spec.emissiveIntensity ?? 1;
  } else {
    mat.emissiveIntensity = 0;
  }
  if (spec.opacity !== undefined) {
    mat.opacity = spec.opacity;
    mat.transparent = spec.opacity < 1;
  }
  if (spec.transmission !== undefined) {
    mat.transmission = spec.transmission;
  }
  mat.needsUpdate = true;
}
