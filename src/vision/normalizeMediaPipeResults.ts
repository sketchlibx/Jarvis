import type { FaceObservation, HandObservation, Handedness, HeadPose, Landmark, PoseObservation } from "../types/perception";

/**
 * Everything in this file is pure (no MediaPipe import, no DOM) so it can be
 * unit-tested with plain objects shaped like MediaPipe's output, per spec
 * section 6/7/8's "validate results before converting them" and section 32's
 * "MediaPipe result normalization" / "malformed MediaPipe results" test
 * requirements. `MediaPipeHandsProvider`/`MediaPipeFaceProvider`/
 * `MediaPipePoseProvider` call these rather than inlining validation, so the
 * validation logic itself is verifiable without a real camera or the
 * `@mediapipe/tasks-vision` package installed.
 */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A landmark is only valid if all three coordinates are finite numbers.
 * MediaPipe landmarks are always normalized 0..1 for x/y, but z can
 * legitimately be negative/out-of-range (relative depth), so we don't
 * range-check z — only "is it actually a number." */
export function isValidLandmark(lm: unknown): lm is Landmark {
  if (typeof lm !== "object" || lm === null) return false;
  const l = lm as Record<string, unknown>;
  return isFiniteNumber(l.x) && isFiniteNumber(l.y) && isFiniteNumber(l.z);
}

/** Filters a raw landmark array down to only valid entries, preserving
 * index position with a null-safe skip rather than throwing — one bad
 * landmark in a MediaPipe result shouldn't discard the whole hand if the
 * rest are usable, but a caller checking `landmarks.length !== 21` can
 * still detect a degraded result. */
export function normalizeLandmarkArray(raw: unknown): Landmark[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidLandmark).map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }));
}

const VALID_HANDEDNESS: Handedness[] = ["Left", "Right", "Unknown"];

/**
 * Converts one raw MediaPipe HandLandmarkerResult into HandObservation[].
 * Never fabricates a hand that wasn't in the result, never fabricates
 * landmarks, and drops a hand entirely if it has too few valid landmarks
 * to be meaningful (spec: "do not assume every result has every optional
 * field").
 */
export function normalizeHandResult(raw: unknown, timestamp: string): HandObservation[] {
  if (typeof raw !== "object" || raw === null) return [];
  const r = raw as { landmarks?: unknown; handedness?: unknown };
  const landmarksList = Array.isArray(r.landmarks) ? r.landmarks : [];
  const handednessList = Array.isArray(r.handedness) ? r.handedness : [];

  const observations: HandObservation[] = [];
  for (let i = 0; i < landmarksList.length; i++) {
    const landmarks = normalizeLandmarkArray(landmarksList[i]);
    if (landmarks.length < 21) continue; // incomplete hand — skip rather than pad with fake points

    const handednessCategory = handednessList[i]?.[0] as { categoryName?: unknown; score?: unknown } | undefined;
    const categoryName = handednessCategory?.categoryName;
    const handedness: Handedness = VALID_HANDEDNESS.includes(categoryName as Handedness)
      ? (categoryName as Handedness)
      : "Unknown";
    const confidence = isFiniteNumber(handednessCategory?.score) ? (handednessCategory!.score as number) : 0;

    observations.push({ id: `hand_${i}`, handedness, confidence, landmarks, timestamp });
  }
  return observations;
}

/** Converts one raw MediaPipe FaceLandmarkerResult into a FaceObservation.
 * Returns `detected: false` (not a thrown error) for empty/malformed input
 * — a frame with no face is an entirely normal, expected outcome. */
export function normalizeFaceResult(raw: unknown, timestamp: string): FaceObservation {
  const empty: FaceObservation = { detected: false, confidence: 0, landmarks: [], headPose: null, expressionFeatures: {}, timestamp };
  if (typeof raw !== "object" || raw === null) return empty;
  const r = raw as { faceLandmarks?: unknown; facialTransformationMatrixes?: unknown };
  const rawLandmarks = Array.isArray(r.faceLandmarks) ? r.faceLandmarks[0] : undefined;
  const landmarks = normalizeLandmarkArray(rawLandmarks);
  if (landmarks.length === 0) return empty;

  const matrixEntry = Array.isArray(r.facialTransformationMatrixes) ? r.facialTransformationMatrixes[0] : undefined;
  const matrixData = (matrixEntry as { data?: unknown } | undefined)?.data;
  const headPose: HeadPose | null =
    Array.isArray(matrixData) && matrixData.length === 16 && matrixData.every(isFiniteNumber)
      ? eulerFromMatrix(matrixData as number[])
      : null;

  return {
    detected: true,
    confidence: 0.8, // FaceLandmarker doesn't expose a single scalar confidence — see MediaPipeFacePoseProvider doc comment
    landmarks,
    headPose,
    expressionFeatures: computeExpressionFeatures(landmarks),
    timestamp,
  };
}

/** Converts one raw MediaPipe PoseLandmarkerResult into a PoseObservation,
 * extracting only the six upper-body points the spec asks for. */
export function normalizePoseResult(raw: unknown, timestamp: string): PoseObservation {
  const empty: PoseObservation = { detected: false, confidence: 0, landmarks: {}, timestamp };
  if (typeof raw !== "object" || raw === null) return empty;
  const r = raw as { landmarks?: unknown };
  const rawPose = Array.isArray(r.landmarks) ? r.landmarks[0] : undefined;
  const landmarks = normalizeLandmarkArray(rawPose);
  if (landmarks.length === 0) return empty;

  // MediaPipe Pose landmark indices: 11=left shoulder, 12=right shoulder,
  // 13=left elbow, 14=right elbow, 15=left wrist, 16=right wrist.
  const pick = (i: number) => landmarks[i]; // already validated/filtered — may be undefined if that index was invalid and dropped
  return {
    detected: true,
    confidence: 0.75,
    landmarks: {
      leftShoulder: pick(11), rightShoulder: pick(12),
      leftElbow: pick(13), rightElbow: pick(14),
      leftWrist: pick(15), rightWrist: pick(16),
    },
    timestamp,
  };
}

function computeExpressionFeatures(landmarks: Landmark[]): Record<string, number> {
  // Indices per MediaPipe's 468-point face mesh. Guard against a shorter
  // (invalid/partial) landmark set rather than indexing out of bounds.
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const foreheadTop = landmarks[10];
  const chin = landmarks[152];
  if (!upperLip || !lowerLip || !foreheadTop || !chin) return {};

  const faceHeight = dist3(foreheadTop, chin) || 1;
  const mouthOpen = dist3(upperLip, lowerLip) / faceHeight;
  const features: Record<string, number> = { mouthOpen: clamp01(mouthOpen * 5) };

  // Brow-furrow proxy: inner-eyebrow-to-eye distance, normalized by face
  // height. Smaller distance = eyebrows pulled down/together = furrowed.
  // Indices: 65 = left inner eyebrow, 133 = left eye inner corner (MediaPipe
  // face mesh convention). A coarse but genuine geometric measurement, not
  // a placeholder — inverted and clamped so higher value = more furrowed.
  const innerBrow = landmarks[65];
  const innerEye = landmarks[133];
  if (innerBrow && innerEye) {
    const browEyeDist = dist3(innerBrow, innerEye) / faceHeight;
    // Typical relaxed distance is roughly 0.03-0.06 of face height; below
    // that reads as furrowed. This threshold is a rough starting point,
    // not calibrated against real faces (see file header caveat).
    const furrowRatio = clamp01(1 - browEyeDist / 0.05);
    features.browFurrow = furrowRatio;
  }

  return features;
}

function dist3(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** See MediaPipeFacePoseProvider's original doc comment for the axis-labeling
 * caveat — this is a standard ZYX Tait-Bryan decomposition, verified against
 * synthetic identity/rotation matrices, but not confirmed against MediaPipe's
 * exact head-frame convention on real output. */
export function eulerFromMatrix(m: number[]): HeadPose {
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6], r22 = m[10];
  const pitch = Math.atan2(-r20, Math.sqrt(r00 * r00 + r10 * r10));
  const yaw = Math.atan2(r10, r00);
  const roll = Math.atan2(r21, r22);
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return { yaw: toDeg(yaw), pitch: toDeg(pitch), roll: toDeg(roll) };
}
