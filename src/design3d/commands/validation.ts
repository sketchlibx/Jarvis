/* eslint-disable no-useless-escape */
import type {
  ComponentParameters, ComponentType, DesignCommand, MaterialSpec, ResourceLimits, Transform, Vec3,
} from "../types";
import { ALL_COMPONENT_TYPES, ALL_DESIGN_COMMAND_TYPES } from "../types";
import type { DesignGraph } from "../scene/DesignGraph";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}
function fail(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

// ---------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------

/** Rejects NaN, Infinity, -Infinity, and non-numbers — spec section 13's
 * explicit "scale = Infinity -> REJECT" example, and section 36's
 * "scale = NaN -> REJECT". This is the single choke point every numeric
 * field in a command/spec passes through. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidVec3(v: unknown): v is Vec3 {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isFiniteNumber(o.x) && isFiniteNumber(o.y) && isFiniteNumber(o.z);
}

/** Object identifiers must be plain safe strings — this is also what
 * blocks a path-traversal-shaped componentType/objectId like
 * "../../../.." (spec section 37) from ever being treated as valid,
 * since it fails this same character-class check regardless of which
 * field it appears in. */
export function isSafeIdentifier(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(v);
}

export function isValidComponentType(v: unknown): v is ComponentType {
  return typeof v === "string" && (ALL_COMPONENT_TYPES as string[]).includes(v);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export function isValidHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR_RE.test(v);
}

function inRange(v: number, min: number, max: number): boolean {
  return isFiniteNumber(v) && v >= min && v <= max;
}

// ---------------------------------------------------------------------
// Material validation
// ---------------------------------------------------------------------

export function validateMaterial(material: Partial<MaterialSpec>): ValidationResult {
  const errors: string[] = [];
  if (material.baseColor !== undefined && !isValidHexColor(material.baseColor)) errors.push("material.baseColor must be a #RRGGBB hex string");
  if (material.metallic !== undefined && !inRange(material.metallic, 0, 1)) errors.push("material.metallic must be within 0..1");
  if (material.roughness !== undefined && !inRange(material.roughness, 0, 1)) errors.push("material.roughness must be within 0..1");
  if (material.emissiveColor !== undefined && !isValidHexColor(material.emissiveColor)) errors.push("material.emissiveColor must be a #RRGGBB hex string");
  if (material.emissiveIntensity !== undefined && !inRange(material.emissiveIntensity, 0, 10)) errors.push("material.emissiveIntensity must be within 0..10");
  if (material.opacity !== undefined && !inRange(material.opacity, 0, 1)) errors.push("material.opacity must be within 0..1");
  if (material.transmission !== undefined && !inRange(material.transmission, 0, 1)) errors.push("material.transmission must be within 0..1");
  return errors.length === 0 ? ok() : fail(...errors);
}

// ---------------------------------------------------------------------
// Component parameter validation — per-type numeric ranges. Anything not
// listed here for a given type is rejected rather than silently accepted,
// so an AI can't smuggle an unexpected field (e.g. a "code" parameter)
// through as if it were a legitimate dimension.
// ---------------------------------------------------------------------

interface ParamSchema {
  [key: string]: { min: number; max: number };
}

const COMPONENT_PARAM_SCHEMAS: Partial<Record<ComponentType, ParamSchema>> = {
  box: { width: { min: 0.001, max: 100 }, height: { min: 0.001, max: 100 }, depth: { min: 0.001, max: 100 } },
  cylinder: { radius: { min: 0.001, max: 50 }, height: { min: 0.001, max: 100 }, segments: { min: 3, max: 128 } },
  sphere: { radius: { min: 0.001, max: 50 }, segments: { min: 3, max: 128 } },
  cone: { radius: { min: 0.001, max: 50 }, height: { min: 0.001, max: 100 }, segments: { min: 3, max: 128 } },
  capsule: { radius: { min: 0.001, max: 50 }, length: { min: 0.001, max: 100 } },
  ring: { innerRadius: { min: 0.001, max: 50 }, outerRadius: { min: 0.001, max: 50 }, segments: { min: 3, max: 128 } },
  tube: { radius: { min: 0.001, max: 50 }, thickness: { min: 0.0001, max: 10 } },
  panel: { width: { min: 0.001, max: 100 }, height: { min: 0.001, max: 100 }, thickness: { min: 0.0001, max: 10 } },
  bevelled_panel: { width: { min: 0.001, max: 100 }, height: { min: 0.001, max: 100 }, thickness: { min: 0.0001, max: 10 }, bevel: { min: 0, max: 5 } },
  connector: { length: { min: 0.001, max: 50 }, radius: { min: 0.001, max: 10 } },
  joint: { radius: { min: 0.001, max: 10 } },
  hinge: { length: { min: 0.001, max: 20 }, radius: { min: 0.001, max: 5 } },
  emitter: { radius: { min: 0.001, max: 10 } },
  core: { radius: { min: 0.001, max: 10 } },
  lens: { radius: { min: 0.001, max: 10 } },
  vent: { width: { min: 0.001, max: 20 }, height: { min: 0.001, max: 20 }, slats: { min: 1, max: 64 } },
  grille: { width: { min: 0.001, max: 20 }, height: { min: 0.001, max: 20 }, slats: { min: 1, max: 64 } },
  armor_plate: { width: { min: 0.001, max: 100 }, height: { min: 0.001, max: 100 }, depth: { min: 0.0001, max: 20 }, bevel: { min: 0, max: 5 } },
  handle: { length: { min: 0.001, max: 20 }, radius: { min: 0.001, max: 5 } },
  mount: { width: { min: 0.001, max: 20 }, height: { min: 0.001, max: 20 }, depth: { min: 0.001, max: 20 } },
};

export function validateComponentParameters(type: ComponentType, params: ComponentParameters): ValidationResult {
  const schema = COMPONENT_PARAM_SCHEMAS[type];
  if (!schema) return fail(`no parameter schema registered for component type '${type}'`);

  const errors: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const range = schema[key];
    if (!range) {
      // Boolean flags like `glow` are allowed through unchecked (finite
      // range validation doesn't apply), but unknown numeric-looking keys
      // outside the schema are still rejected — this is what blocks e.g.
      // a `{"code": "..."}` parameter from riding along on a legitimate command.
      if (typeof value === "boolean") continue;
      if (typeof value === "string" && key === "label") continue; // free-text label is explicitly allowed, nothing else is
      errors.push(`unexpected parameter '${key}' for component type '${type}'`);
      continue;
    }
    if (!inRange(Number(value), range.min, range.max)) {
      errors.push(`parameter '${key}' for '${type}' must be within ${range.min}..${range.max}, got ${value}`);
    }
  }
  return errors.length === 0 ? ok() : fail(...errors);
}

export function validateTransform(t: Partial<Transform>): ValidationResult {
  const errors: string[] = [];
  if (t.position !== undefined && !isValidVec3(t.position)) errors.push("transform.position must have finite x/y/z");
  if (t.rotation !== undefined && !isValidVec3(t.rotation)) errors.push("transform.rotation must have finite x/y/z");
  if (t.scale !== undefined) {
    if (!isValidVec3(t.scale)) errors.push("transform.scale must have finite x/y/z");
    else if (t.scale.x <= 0 || t.scale.y <= 0 || t.scale.z <= 0) errors.push("transform.scale components must be > 0 (zero/negative scale is degenerate geometry, not a valid design change)");
    else if (t.scale.x > 1000 || t.scale.y > 1000 || t.scale.z > 1000) errors.push("transform.scale components must be <= 1000");
  }
  return errors.length === 0 ? ok() : fail(...errors);
}

// ---------------------------------------------------------------------
// DesignCommand validation — spec section 13. This is the function every
// AI-generated command MUST pass before CommandExecutor touches the graph.
// ---------------------------------------------------------------------

export function validateCommand(cmd: unknown, graph: DesignGraph, limits: ResourceLimits): ValidationResult {
  if (typeof cmd !== "object" || cmd === null) return fail("command must be an object");
  const c = cmd as Record<string, unknown>;

  if (typeof c.type !== "string" || !(ALL_DESIGN_COMMAND_TYPES as readonly string[]).includes(c.type)) {
    // Catches "executeJavascript", "run_shell", or any other invented
    // command type outright — spec section 37's core adversarial case.
    return fail(`unknown or missing command type: ${String(c.type)}`);
  }

  switch (c.type as DesignCommand["type"]) {
    case "CREATE_OBJECT": {
      const errors: string[] = [];
      if (!isSafeIdentifier(c.objectId)) errors.push("objectId must be a safe identifier");
      if (typeof c.objectId === "string" && graph.has(c.objectId)) errors.push(`objectId '${c.objectId}' already exists`);
      if (!isValidComponentType(c.componentType)) errors.push(`invalid componentType: ${String(c.componentType)}`);
      if (c.parentId !== undefined && c.parentId !== null) {
        if (!isSafeIdentifier(c.parentId)) errors.push("parentId must be a safe identifier or null");
        else if (!graph.has(c.parentId as string)) errors.push(`parentId '${c.parentId}' does not exist`);
        else if (graph.depthOf(c.parentId as string) + 1 >= limits.maxHierarchyDepth) errors.push(`hierarchy depth limit (${limits.maxHierarchyDepth}) exceeded`);
      }
      if (graph.size >= limits.maxObjects) errors.push(`object limit (${limits.maxObjects}) reached`);
      if (errors.length > 0) return fail(...errors);
      if (isValidComponentType(c.componentType) && typeof c.parameters === "object" && c.parameters !== null) {
        const paramResult = validateComponentParameters(c.componentType, c.parameters as ComponentParameters);
        if (!paramResult.valid) return paramResult;
      }
      if (c.transform !== undefined) {
        const tResult = validateTransform(c.transform as Partial<Transform>);
        if (!tResult.valid) return tResult;
      }
      if (c.material !== undefined) {
        const mResult = validateMaterial(c.material as Partial<MaterialSpec>);
        if (!mResult.valid) return mResult;
      }
      return ok();
    }

    case "DELETE_OBJECT":
    case "REMOVE_COMPONENT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      return ok();
    }

    case "UPDATE_OBJECT":
    case "ADD_COMPONENT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      const existing = graph.get(c.objectId as string);
      if (!existing) return fail(`objectId '${c.objectId}' does not exist`);
      const paramsField = c.type === "ADD_COMPONENT" ? c.parameters ?? {} : c.parameters;
      if (typeof paramsField !== "object" || paramsField === null) return fail("parameters must be an object");
      const componentType = c.type === "ADD_COMPONENT" && isValidComponentType(c.componentType) ? c.componentType : existing.type;
      if (c.type === "ADD_COMPONENT" && !isValidComponentType(c.componentType)) return fail(`invalid componentType: ${String(c.componentType)}`);
      return validateComponentParameters(componentType, paramsField as ComponentParameters);
    }

    case "MOVE_OBJECT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (!isValidVec3(c.position)) return fail("position must have finite x/y/z");
      return ok();
    }
    case "ROTATE_OBJECT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (!isValidVec3(c.rotation)) return fail("rotation must have finite x/y/z");
      return ok();
    }
    case "SCALE_OBJECT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      return validateTransform({ scale: c.scale as Vec3 });
    }

    case "SET_MATERIAL": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (typeof c.material !== "object" || c.material === null) return fail("material must be an object");
      return validateMaterial(c.material as Partial<MaterialSpec>);
    }
    case "SET_COLOR": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (!isValidHexColor(c.color)) return fail("color must be a #RRGGBB hex string");
      return ok();
    }

    case "PARENT_OBJECT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (c.newParentId !== null) {
        if (!isSafeIdentifier(c.newParentId)) return fail("newParentId must be a safe identifier or null");
        if (!graph.has(c.newParentId as string)) return fail(`newParentId '${c.newParentId}' does not exist`);
        if (c.newParentId === c.objectId) return fail("an object cannot be parented to itself");
        // Cycle guard: reject if the proposed new parent is actually a
        // descendant of the object being moved (spec section 10 implies a
        // consistent tree; a cycle would break world-transform composition).
        if (graph.isAncestor(c.objectId as string, c.newParentId as string)) return fail("re-parenting would create a cycle");
        if (graph.depthOf(c.newParentId as string) + 1 >= limits.maxHierarchyDepth) return fail(`hierarchy depth limit (${limits.maxHierarchyDepth}) exceeded`);
      }
      return ok();
    }

    case "DUPLICATE_OBJECT": {
      if (!isSafeIdentifier(c.objectId)) return fail("objectId must be a safe identifier");
      if (!graph.has(c.objectId as string)) return fail(`objectId '${c.objectId}' does not exist`);
      if (!isSafeIdentifier(c.newObjectId)) return fail("newObjectId must be a safe identifier");
      if (graph.has(c.newObjectId as string)) return fail(`newObjectId '${c.newObjectId}' already exists`);
      if (graph.size >= limits.maxObjects) return fail(`object limit (${limits.maxObjects}) reached`);
      return ok();
    }

    case "SAVE_PROJECT": {
      if (typeof c.name !== "string" || c.name.trim().length === 0 || c.name.length > 200) return fail("project name must be a non-empty string up to 200 characters");
      return ok();
    }
    case "LOAD_PROJECT": {
      if (!isSafeIdentifier(c.projectId)) return fail("projectId must be a safe identifier");
      return ok();
    }

    default:
      return fail(`unhandled command type: ${(c as { type: string }).type}`);
  }
}

/** Validates a whole AI-produced DesignSpecification before any of its
 * components are turned into commands — catches malformed specs earlier
 * and with clearer error attribution than validating command-by-command
 * after translation. */
export function validateSpecification(spec: unknown, limits: ResourceLimits): ValidationResult {
  if (typeof spec !== "object" || spec === null) return fail("specification must be an object");
  const s = spec as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof s.schemaVersion !== "string") errors.push("schemaVersion is required");
  if (typeof s.project !== "object" || s.project === null || typeof (s.project as any).name !== "string") errors.push("project.name is required");
  if (typeof s.assembly !== "object" || s.assembly === null || typeof (s.assembly as any).type !== "string") errors.push("assembly.type is required");
  if (!Array.isArray(s.components)) {
    errors.push("components must be an array");
    return fail(...errors);
  }
  if (s.components.length > limits.maxObjects) errors.push(`component count (${s.components.length}) exceeds object limit (${limits.maxObjects})`);

  const seenIds = new Set<string>();
  (s.components as unknown[]).forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) { errors.push(`components[${i}] must be an object`); return; }
    const comp = raw as Record<string, unknown>;
    if (!isSafeIdentifier(comp.id)) errors.push(`components[${i}].id must be a safe identifier`);
    else if (seenIds.has(comp.id as string)) errors.push(`components[${i}].id '${comp.id}' is duplicated`);
    else seenIds.add(comp.id as string);
    if (!isValidComponentType(comp.type)) errors.push(`components[${i}].type invalid: ${String(comp.type)}`);
    if (comp.parentId !== undefined && comp.parentId !== null && !isSafeIdentifier(comp.parentId)) errors.push(`components[${i}].parentId invalid`);
    if (isValidComponentType(comp.type) && typeof comp.parameters === "object" && comp.parameters !== null) {
      const r = validateComponentParameters(comp.type, comp.parameters as ComponentParameters);
      if (!r.valid) errors.push(...r.errors.map((e) => `components[${i}]: ${e}`));
    } else if (comp.parameters !== undefined) {
      errors.push(`components[${i}].parameters must be an object`);
    }
    if (comp.material !== undefined) {
      const r = validateMaterial(comp.material as Partial<MaterialSpec>);
      if (!r.valid) errors.push(...r.errors.map((e) => `components[${i}]: ${e}`));
    }
    if (comp.transform !== undefined) {
      const r = validateTransform(comp.transform as Partial<Transform>);
      if (!r.valid) errors.push(...r.errors.map((e) => `components[${i}]: ${e}`));
    }
  });

  // Validate parentId references point at another component IN this spec
  // (or nothing — root) — not at some arbitrary external/graph-only id,
  // since a spec is validated before anything is inserted into a graph.
  (s.components as Array<Record<string, unknown>>).forEach((comp, i) => {
    if (comp.parentId && !seenIds.has(comp.parentId as string)) {
      errors.push(`components[${i}].parentId '${comp.parentId}' does not match any component id in this specification`);
    }
  });

  return errors.length === 0 ? ok() : fail(...errors);
}
