import type { DesignObject, DesignProjectFile } from "../types";
import { CURRENT_PROJECT_SCHEMA_VERSION } from "../types";
import { DesignGraph } from "../scene/DesignGraph";

export interface SerializationResult {
  success: boolean;
  file?: DesignProjectFile;
  errors?: string[];
}

export interface DeserializationResult {
  success: boolean;
  objects?: DesignObject[];
  errors?: string[];
  migratedFrom?: string; // set if a migration ran
}

/** Serializes a DesignGraph into the on-disk project format. Never stores
 * renderer objects (spec section 21) — DesignGraph is already pure data,
 * so this is a straightforward, lossless snapshot. */
export function serializeProject(graph: DesignGraph, projectId: string, name: string, createdAt: string): SerializationResult {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { success: false, errors: ["project name must not be empty"] };
  }
  const file: DesignProjectFile = {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId,
    name,
    createdAt,
    updatedAt: new Date().toISOString(),
    objects: graph.snapshot(),
  };
  return { success: true, file };
}

/**
 * Parses and validates a project file, running migrations for older
 * schema versions rather than either silently corrupting them or refusing
 * to load them at all (spec section 22's explicit requirement). Migration
 * registry is a simple version -> transform chain; add a new entry here
 * whenever CURRENT_PROJECT_SCHEMA_VERSION changes in a way that needs one.
 */
export function deserializeProject(raw: unknown): DeserializationResult {
  if (typeof raw !== "object" || raw === null) return { success: false, errors: ["project file must be a JSON object"] };
  const data = raw as Record<string, unknown>;

  if (typeof data.schemaVersion !== "string") return { success: false, errors: ["missing schemaVersion"] };
  if (!Array.isArray(data.objects)) return { success: false, errors: ["objects must be an array"] };

  let objects = data.objects as unknown[];
  let migratedFrom: string | undefined;

  if (data.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[data.schemaVersion as string];
    if (!migration) {
      return { success: false, errors: [`unsupported schemaVersion '${data.schemaVersion}' — no migration path to ${CURRENT_PROJECT_SCHEMA_VERSION}`] };
    }
    objects = migration(objects);
    migratedFrom = data.schemaVersion as string;
  }

  const validated: DesignObject[] = [];
  const errors: string[] = [];
  for (let i = 0; i < objects.length; i++) {
    const result = validateDesignObjectShape(objects[i]);
    if (!result.valid) {
      errors.push(`objects[${i}]: ${result.errors.join(", ")}`);
      continue;
    }
    validated.push(objects[i] as DesignObject);
  }

  if (errors.length > 0) return { success: false, errors };

  // Referential integrity: every non-null parentId must point at another
  // object actually present in this file — otherwise loading it would
  // silently produce orphaned objects with no visible parent.
  const ids = new Set(validated.map((o) => o.id));
  for (const obj of validated) {
    if (obj.parentId !== null && !ids.has(obj.parentId)) {
      return { success: false, errors: [`object '${obj.id}' references missing parentId '${obj.parentId}'`] };
    }
  }

  return { success: true, objects: validated, migratedFrom };
}

/** Registry of migrations keyed by the OLD schemaVersion they migrate
 * from. Empty for now (1.0 is the only version that has ever existed),
 * kept here so the mechanism exists and is tested before it's ever
 * actually needed — per spec section 22, "never silently corrupt old
 * projects" has to be true from day one, not retrofitted later. */
const MIGRATIONS: Record<string, (objects: unknown[]) => unknown[]> = {
  // Example shape for a future migration:
  // "0.9": (objects) => objects.map((o: any) => ({ ...o, metadata: o.metadata ?? {} })),
};

function validateDesignObjectShape(raw: unknown): { valid: boolean; errors: string[] } {
  if (typeof raw !== "object" || raw === null) return { valid: false, errors: ["must be an object"] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof o.id !== "string" || o.id.length === 0) errors.push("id must be a non-empty string");
  if (typeof o.type !== "string") errors.push("type must be a string");
  if (typeof o.name !== "string") errors.push("name must be a string");
  if (o.parentId !== null && typeof o.parentId !== "string") errors.push("parentId must be a string or null");
  if (typeof o.transform !== "object" || o.transform === null) errors.push("transform must be an object");
  if (typeof o.material !== "object" || o.material === null) errors.push("material must be an object");
  if (typeof o.parameters !== "object" || o.parameters === null) errors.push("parameters must be an object");
  return { valid: errors.length === 0, errors };
}

/** Convenience: load a project file's objects directly into a fresh graph. */
export function loadIntoGraph(graph: DesignGraph, objects: DesignObject[]): void {
  graph.restoreFrom(objects);
}
