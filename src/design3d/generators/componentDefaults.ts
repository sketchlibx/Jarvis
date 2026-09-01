import type { ComponentParameters, ComponentType } from "../types";
import { validateComponentParameters } from "../commands/validation";

/**
 * Default parameters per component type — sensible starting geometry so
 * "add an emitter" works with zero parameters specified, rather than
 * requiring the AI to invent every dimension from scratch. These are
 * PARAMETERS (validated numbers), not meshes — spec section 39's
 * distinction: this is the "procedural generation of a design
 * specification," not an ML mesh-generation pipeline.
 */
const DEFAULTS: Record<ComponentType, ComponentParameters> = {
  box: { width: 0.2, height: 0.2, depth: 0.2 },
  cylinder: { radius: 0.1, height: 0.3, segments: 24 },
  sphere: { radius: 0.1, segments: 24 },
  cone: { radius: 0.1, height: 0.2, segments: 24 },
  capsule: { radius: 0.06, length: 0.3 },
  ring: { innerRadius: 0.08, outerRadius: 0.1, segments: 32 },
  tube: { radius: 0.05, thickness: 0.01 },
  panel: { width: 0.3, height: 0.2, thickness: 0.01 },
  bevelled_panel: { width: 0.3, height: 0.2, thickness: 0.015, bevel: 0.005 },
  connector: { length: 0.1, radius: 0.02 },
  joint: { radius: 0.03 },
  hinge: { length: 0.08, radius: 0.015 },
  emitter: { radius: 0.025 },
  core: { radius: 0.03 },
  lens: { radius: 0.02 },
  vent: { width: 0.12, height: 0.06, slats: 6 },
  grille: { width: 0.12, height: 0.06, slats: 8 },
  armor_plate: { width: 0.15, height: 0.1, depth: 0.02, bevel: 0.003 },
  handle: { length: 0.12, radius: 0.015 },
  mount: { width: 0.05, height: 0.05, depth: 0.03 },
};

/**
 * Builds a validated parameter set for `type`, starting from that type's
 * defaults and applying `overrides` on top. Returns validation errors
 * rather than throwing — callers (the AI translation layer, UI forms)
 * decide how to surface that.
 */
export function generateComponentParameters(
  type: ComponentType,
  overrides: Partial<ComponentParameters> = {}
): { parameters: ComponentParameters; errors: string[] } {
  const base = DEFAULTS[type];
  // Strip any explicitly-undefined override values before merging — a
  // Partial<> allows `{ width: undefined }` at the type level, but that
  // should mean "no override," not "set width to undefined," which would
  // otherwise poison ComponentParameters (which disallows undefined values).
  const cleanOverrides: ComponentParameters = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) cleanOverrides[k] = v;
  }
  const merged: ComponentParameters = { ...base, ...cleanOverrides };
  const result = validateComponentParameters(type, merged);
  return { parameters: merged, errors: result.valid ? [] : result.errors };
}

export function defaultParametersFor(type: ComponentType): ComponentParameters {
  return { ...DEFAULTS[type] };
}
