// ---------------------------------------------------------------------
// Transform / common primitives
// ---------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3; // Euler degrees, matches the rest of the perception system's convention
  scale: Vec3;
}

export const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

// ---------------------------------------------------------------------
// Component library — spec section 8. General engineering primitives,
// deliberately not a hard-coded "Iron Man suit" — see generators/*.ts.
// ---------------------------------------------------------------------

export type ComponentType =
  | "box" | "cylinder" | "sphere" | "cone" | "capsule" | "ring" | "tube"
  | "panel" | "bevelled_panel" | "connector" | "joint" | "hinge"
  | "emitter" | "core" | "lens" | "vent" | "grille" | "armor_plate"
  | "handle" | "mount";

export const ALL_COMPONENT_TYPES: ComponentType[] = [
  "box", "cylinder", "sphere", "cone", "capsule", "ring", "tube",
  "panel", "bevelled_panel", "connector", "joint", "hinge",
  "emitter", "core", "lens", "vent", "grille", "armor_plate",
  "handle", "mount",
];

/** Loose bag of numeric/string/boolean parameters — the specific shape
 * differs per component type (see generators/*.ts for what each one reads).
 * Validation (validateComponentParameters) enforces per-type ranges rather
 * than relying on the TS type system alone, since these ultimately come
 * from AI-generated JSON. */
export type ComponentParameters = Record<string, number | string | boolean>;

// ---------------------------------------------------------------------
// Materials — spec sections 16, 17
// ---------------------------------------------------------------------

export type MaterialKind =
  | "metal" | "matte_metal" | "glossy_metal" | "glass" | "carbon_fiber"
  | "plastic" | "rubber" | "emissive" | "holographic" | "transparent";

export interface MaterialSpec {
  kind: MaterialKind;
  baseColor: string; // hex, e.g. "#4ee1ff"
  metallic: number;  // 0..1
  roughness: number; // 0..1
  emissiveColor?: string;
  emissiveIntensity?: number; // 0..10, reasonable ceiling — see validation
  opacity?: number; // 0..1
  transmission?: number; // 0..1, glass/transparent only
}

/** Style presets, explicitly NOT real-world manufacturing specs — spec
 * section 17 requires this framing. */
export type MaterialPresetName =
  | "titanium" | "graphite" | "carbon" | "ceramic" | "chrome"
  | "dark_alloy" | "neon_polymer" | "energy_core" | "holographic_glass";

// ---------------------------------------------------------------------
// DesignObject — spec section 7
// ---------------------------------------------------------------------

export interface DesignObject {
  id: string;         // stable, never re-derived from displayName
  type: ComponentType;
  name: string;        // display name only — never used as an identity key
  parentId: string | null;
  transform: Transform;
  material: MaterialSpec;
  parameters: ComponentParameters;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// DesignSpecification — spec section 11. What the AI actually produces;
// never raw Three.js calls.
// ---------------------------------------------------------------------

export interface DesignSpecification {
  schemaVersion: string; // e.g. "1.0" — spec section 22
  project: {
    name: string;
  };
  assembly: {
    type: string; // free-form label, e.g. "gauntlet" — descriptive only, not validated against a fixed enum
  };
  components: Array<{
    type: ComponentType;
    id: string;
    parentId?: string | null;
    parameters: ComponentParameters;
    material?: Partial<MaterialSpec>;
    transform?: Partial<Transform>;
  }>;
}

// ---------------------------------------------------------------------
// DesignCommand — spec section 12. The ONLY interface the AI's structured
// output is allowed to drive; there is no "run this Three.js code" command.
// ---------------------------------------------------------------------

export type DesignCommand =
  | { type: "CREATE_OBJECT"; objectId: string; componentType: ComponentType; parentId?: string | null; parameters?: ComponentParameters; transform?: Partial<Transform>; material?: Partial<MaterialSpec> }
  | { type: "DELETE_OBJECT"; objectId: string }
  | { type: "UPDATE_OBJECT"; objectId: string; parameters: ComponentParameters }
  | { type: "MOVE_OBJECT"; objectId: string; position: Vec3 }
  | { type: "ROTATE_OBJECT"; objectId: string; rotation: Vec3 }
  | { type: "SCALE_OBJECT"; objectId: string; scale: Vec3 }
  | { type: "SET_MATERIAL"; objectId: string; material: Partial<MaterialSpec> }
  | { type: "SET_COLOR"; objectId: string; color: string }
  | { type: "ADD_COMPONENT"; objectId: string; componentType: ComponentType; parameters?: ComponentParameters }
  | { type: "REMOVE_COMPONENT"; objectId: string }
  | { type: "PARENT_OBJECT"; objectId: string; newParentId: string | null }
  | { type: "DUPLICATE_OBJECT"; objectId: string; newObjectId: string }
  | { type: "SAVE_PROJECT"; name: string }
  | { type: "LOAD_PROJECT"; projectId: string };

export const ALL_DESIGN_COMMAND_TYPES = [
  "CREATE_OBJECT", "DELETE_OBJECT", "UPDATE_OBJECT", "MOVE_OBJECT", "ROTATE_OBJECT",
  "SCALE_OBJECT", "SET_MATERIAL", "SET_COLOR", "ADD_COMPONENT", "REMOVE_COMPONENT",
  "PARENT_OBJECT", "DUPLICATE_OBJECT", "SAVE_PROJECT", "LOAD_PROJECT",
] as const;

// ---------------------------------------------------------------------
// Resource limits — spec section 31. Configurable, but the AI cannot
// bypass them — see validation/limits.ts, which is the only place these
// are enforced.
// ---------------------------------------------------------------------

export interface ResourceLimits {
  maxObjects: number;
  maxHierarchyDepth: number;
  maxImportFileSizeBytes: number;
  maxTextureSize: number; // pixels, one dimension
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxObjects: 500,
  maxHierarchyDepth: 12,
  maxImportFileSizeBytes: 50 * 1024 * 1024, // 50MB
  maxTextureSize: 4096,
};

// ---------------------------------------------------------------------
// Project file format — spec sections 21, 22
// ---------------------------------------------------------------------

export interface DesignProjectFile {
  schemaVersion: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  objects: DesignObject[];
}

export const CURRENT_PROJECT_SCHEMA_VERSION = "1.0";
