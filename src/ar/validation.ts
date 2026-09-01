import type { ARCommand, AnchorType, AROffset } from "./types";
import { ALL_AR_COMMAND_TYPES, AR_SCALE_LIMITS, IMPLEMENTED_ANCHOR_TYPES } from "./types";
import { isFiniteNumber, isSafeIdentifier, isValidVec3 } from "../design3d/commands/validation";

export interface ARValidationResult {
  valid: boolean;
  errors: string[];
}
function ok(): ARValidationResult { return { valid: true, errors: [] }; }
function fail(...errors: string[]): ARValidationResult { return { valid: false, errors }; }

function isValidAnchorType(v: unknown): v is AnchorType {
  return typeof v === "string" && (IMPLEMENTED_ANCHOR_TYPES as string[]).includes(v);
}

function isValidQuaternion(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const q = v as Record<string, unknown>;
  return isFiniteNumber(q.x) && isFiniteNumber(q.y) && isFiniteNumber(q.z) && isFiniteNumber(q.w);
}

function validateOffset(offset: Partial<AROffset>): ARValidationResult {
  const errors: string[] = [];
  if (offset.position !== undefined && !isValidVec3(offset.position)) errors.push("offset.position must have finite x/y/z");
  if (offset.rotation !== undefined && !isValidQuaternion(offset.rotation)) errors.push("offset.rotation must be a valid quaternion");
  if (offset.scaleMultiplier !== undefined) {
    if (!isFiniteNumber(offset.scaleMultiplier)) errors.push("offset.scaleMultiplier must be finite");
    else if (offset.scaleMultiplier < AR_SCALE_LIMITS.min || offset.scaleMultiplier > AR_SCALE_LIMITS.max) {
      errors.push(`offset.scaleMultiplier must be within ${AR_SCALE_LIMITS.min}..${AR_SCALE_LIMITS.max}`);
    }
  }
  return errors.length === 0 ? ok() : fail(...errors);
}

/**
 * Validates an AR command before it can affect anything. Same reject-closed
 * philosophy as Phase 4's `validateCommand` — unknown command types,
 * malformed identifiers, and out-of-range/non-finite numeric values are
 * all rejected here rather than downstream. `existingInstanceIds` and
 * `existingDesignObjectIds` let this function confirm referenced objects
 * actually exist, mirroring how Phase 4's validator checks against a live
 * `DesignGraph`.
 */
export function validateARCommand(
  cmd: unknown,
  existingInstanceIds: Set<string>,
  existingDesignObjectIds: Set<string>
): ARValidationResult {
  if (typeof cmd !== "object" || cmd === null) return fail("AR command must be an object");
  const c = cmd as Record<string, unknown>;

  if (typeof c.type !== "string" || !(ALL_AR_COMMAND_TYPES as readonly string[]).includes(c.type)) {
    return fail(`unknown or missing AR command type: ${String(c.type)}`);
  }

  switch (c.type as ARCommand["type"]) {
    case "ATTACH_AR_OBJECT": {
      const errors: string[] = [];
      if (!isSafeIdentifier(c.instanceId)) errors.push("instanceId must be a safe identifier");
      else if (existingInstanceIds.has(c.instanceId as string)) errors.push(`instanceId '${c.instanceId}' already exists`);
      if (!isSafeIdentifier(c.designObjectId)) errors.push("designObjectId must be a safe identifier");
      else if (!existingDesignObjectIds.has(c.designObjectId as string)) errors.push(`designObjectId '${c.designObjectId}' does not exist in the current design`);
      if (!isValidAnchorType(c.anchorType)) errors.push(`invalid or unsupported anchorType: ${String(c.anchorType)}`);
      return errors.length === 0 ? ok() : fail(...errors);
    }

    case "DETACH_AR_OBJECT":
    case "SHOW_AR_OBJECT":
    case "HIDE_AR_OBJECT":
    case "START_AR_INTERACTION":
    case "STOP_AR_INTERACTION": {
      if (!isSafeIdentifier(c.instanceId)) return fail("instanceId must be a safe identifier");
      if (!existingInstanceIds.has(c.instanceId as string)) return fail(`instanceId '${c.instanceId}' does not exist`);
      return ok();
    }

    case "SET_AR_ANCHOR": {
      if (!isSafeIdentifier(c.instanceId)) return fail("instanceId must be a safe identifier");
      if (!existingInstanceIds.has(c.instanceId as string)) return fail(`instanceId '${c.instanceId}' does not exist`);
      if (!isValidAnchorType(c.anchorType)) return fail(`invalid or unsupported anchorType: ${String(c.anchorType)}`);
      return ok();
    }

    case "SET_AR_OFFSET": {
      if (!isSafeIdentifier(c.instanceId)) return fail("instanceId must be a safe identifier");
      if (!existingInstanceIds.has(c.instanceId as string)) return fail(`instanceId '${c.instanceId}' does not exist`);
      if (typeof c.offset !== "object" || c.offset === null) return fail("offset must be an object");
      return validateOffset(c.offset as Partial<AROffset>);
    }

    case "SET_AR_SCALE": {
      if (!isSafeIdentifier(c.instanceId)) return fail("instanceId must be a safe identifier");
      if (!existingInstanceIds.has(c.instanceId as string)) return fail(`instanceId '${c.instanceId}' does not exist`);
      if (!isFiniteNumber(c.scaleMultiplier)) return fail("scaleMultiplier must be a finite number");
      if ((c.scaleMultiplier as number) < AR_SCALE_LIMITS.min || (c.scaleMultiplier as number) > AR_SCALE_LIMITS.max) {
        return fail(`scaleMultiplier must be within ${AR_SCALE_LIMITS.min}..${AR_SCALE_LIMITS.max}`);
      }
      return ok();
    }

    case "SET_AR_ROTATION": {
      if (!isSafeIdentifier(c.instanceId)) return fail("instanceId must be a safe identifier");
      if (!existingInstanceIds.has(c.instanceId as string)) return fail(`instanceId '${c.instanceId}' does not exist`);
      if (!isValidVec3(c.rotationDegrees)) return fail("rotationDegrees must have finite x/y/z");
      return ok();
    }

    default:
      return fail(`unhandled AR command type`);
  }
}
