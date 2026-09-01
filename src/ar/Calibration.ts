import type { ARCalibration } from "./types";
import { CALIBRATION_SCHEMA_VERSION, DEFAULT_CALIBRATION } from "./types";
import { isFiniteNumber, isValidVec3 } from "../design3d/commands/validation";

export interface CalibrationValidationResult {
  valid: boolean;
  errors: string[];
}

const SMOOTHING_RANGE = { min: 0.01, max: 1 };
const OBJECT_SIZE_RANGE = { min: 0.01, max: 100 };
const CAMERA_SCALE_RANGE = { min: 0.01, max: 100 };

export function validateCalibration(raw: unknown): CalibrationValidationResult {
  if (typeof raw !== "object" || raw === null) return { valid: false, errors: ["calibration must be an object"] };
  const c = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof c.schemaVersion !== "string") errors.push("schemaVersion is required");
  if (!isFiniteNumber(c.objectSizeMultiplier) || (c.objectSizeMultiplier as number) < OBJECT_SIZE_RANGE.min || (c.objectSizeMultiplier as number) > OBJECT_SIZE_RANGE.max) {
    errors.push(`objectSizeMultiplier must be within ${OBJECT_SIZE_RANGE.min}..${OBJECT_SIZE_RANGE.max}`);
  }
  if (!isValidVec3(c.wristOffset)) errors.push("wristOffset must have finite x/y/z");
  if (!isValidVec3(c.rotationOffsetDegrees)) errors.push("rotationOffsetDegrees must have finite x/y/z");
  if (!isFiniteNumber(c.cameraScale) || (c.cameraScale as number) < CAMERA_SCALE_RANGE.min || (c.cameraScale as number) > CAMERA_SCALE_RANGE.max) {
    errors.push(`cameraScale must be within ${CAMERA_SCALE_RANGE.min}..${CAMERA_SCALE_RANGE.max}`);
  }
  if (!isFiniteNumber(c.smoothingFactor) || (c.smoothingFactor as number) < SMOOTHING_RANGE.min || (c.smoothingFactor as number) > SMOOTHING_RANGE.max) {
    errors.push(`smoothingFactor must be within ${SMOOTHING_RANGE.min}..${SMOOTHING_RANGE.max}`);
  }

  return { valid: errors.length === 0, errors };
}

/** Parses and validates a calibration blob, migrating older schema
 * versions where a migration is registered (empty for now — 1.0 is the
 * only version that has ever existed, same posture as Phase 4's project
 * migration registry: the mechanism exists and is exercised by tests
 * before it's ever actually needed). */
export function deserializeCalibration(raw: unknown): { success: boolean; calibration?: ARCalibration; errors?: string[] } {
  if (typeof raw !== "object" || raw === null) return { success: false, errors: ["calibration must be an object"] };
  const data = raw as Record<string, unknown>;

  if (data.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
    const migration = CALIBRATION_MIGRATIONS[data.schemaVersion as string];
    if (!migration) return { success: false, errors: [`unsupported calibration schemaVersion '${data.schemaVersion}'`] };
    const migrated = migration(data);
    return deserializeCalibration(migrated); // re-validate the migrated shape through the same path
  }

  const result = validateCalibration(data);
  if (!result.valid) return { success: false, errors: result.errors };
  return { success: true, calibration: data as unknown as ARCalibration };
}

const CALIBRATION_MIGRATIONS: Record<string, (data: Record<string, unknown>) => Record<string, unknown>> = {
  // Example shape for a future migration — none needed yet.
};

export function resetCalibration(): ARCalibration {
  return { ...DEFAULT_CALIBRATION, wristOffset: { ...DEFAULT_CALIBRATION.wristOffset }, rotationOffsetDegrees: { ...DEFAULT_CALIBRATION.rotationOffsetDegrees } };
}
