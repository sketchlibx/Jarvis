import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { DEFAULT_RESOURCE_LIMITS } from "../types";

/**
 * # Status: UNVERIFIED (no browser/WebGL context in this sandbox).
 *
 * Written against Three.js's real GLTFLoader/GLTFExporter API, not a
 * hand-rolled parser. Per spec section 23's explicit requirement, this
 * does NOT claim perfect round-trip preservation:
 *
 * - Import preserves hierarchy, transforms, and meshes/materials as
 *   Three.js's own loader interprets them. It does NOT map imported
 *   meshes back into JARVIS's own `DesignObject`/`ComponentType` system —
 *   an imported GLTF becomes an opaque, non-editable "imported_asset" node
 *   in the graph (own component type, no per-parameter inspector fields),
 *   not a set of native procedural components. Re-exporting it should be
 *   lossless-ish (Three.js round-trips its own scene graph reasonably
 *   well); converting it INTO parametric JARVIS components is out of
 *   scope for Phase 4.
 * - Export serializes the current Three.js scene graph as GLTF/GLB. Custom
 *   JARVIS metadata (component type, parameter values) is attached via
 *   GLTF's `extras` field where possible, but a GLTF viewer that isn't
 *   JARVIS will not understand or preserve that metadata.
 */

export interface ImportResult {
  success: boolean;
  object?: THREE.Object3D;
  errors?: string[];
}

/** Validates size before ever handing bytes to the parser — spec section
 * 33's "imported files are untrusted input" requirement. This check runs
 * BEFORE parsing, not after, so a pathologically large file can't even
 * begin decoding. */
export function validateImportFile(bytes: ArrayBuffer, maxSizeBytes = DEFAULT_RESOURCE_LIMITS.maxImportFileSizeBytes): { valid: boolean; error?: string } {
  if (bytes.byteLength === 0) return { valid: false, error: "file is empty" };
  if (bytes.byteLength > maxSizeBytes) return { valid: false, error: `file exceeds maximum import size (${maxSizeBytes} bytes)` };
  return { valid: true };
}

export async function importGLTF(bytes: ArrayBuffer, limits = DEFAULT_RESOURCE_LIMITS): Promise<ImportResult> {
  const sizeCheck = validateImportFile(bytes, limits.maxImportFileSizeBytes);
  if (!sizeCheck.valid) return { success: false, errors: [sizeCheck.error!] };

  const loader = new GLTFLoader();
  try {
    // GLTFLoader's parse() never executes embedded scripts — GLTF/GLB has
    // no script/code content type at all, unlike e.g. SVG. There is
    // nothing to "disable" here; the format is inert by construction. We
    // still never treat the result as anything other than geometry/material
    // data (spec section 33's "do not treat imported assets as executable code").
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(bytes, "", (result: { scene: THREE.Group }) => resolve(result), (err: ErrorEvent) => reject(err));
    });

    let objectCount = 0;
    gltf.scene.traverse(() => { objectCount += 1; });
    if (objectCount > limits.maxObjects) {
      // Dispose immediately — we're rejecting it, don't leak the parsed geometry.
      disposeObject3D(gltf.scene);
      return { success: false, errors: [`imported asset has ${objectCount} nodes, exceeding the object limit (${limits.maxObjects})`] };
    }

    return { success: true, object: gltf.scene };
  } catch (err) {
    return { success: false, errors: [`GLTF parse error: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

export async function exportGLTF(root: THREE.Object3D, binary: boolean): Promise<ArrayBuffer | object> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result: ArrayBuffer | object) => resolve(result),
      (err: ErrorEvent) => reject(err),
      { binary }
    );
  });
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose?.();
    }
  });
}
