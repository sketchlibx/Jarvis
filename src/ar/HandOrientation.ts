import type { Landmark, HandObservation } from "../types/perception";
import type { Vec3 } from "../design3d/types";
import type { Quaternion } from "./types";
import { IDENTITY_QUATERNION } from "./types";

/**
 * Derives a stable hand-frame orientation from three landmarks — wrist (0),
 * index MCP (5), pinky MCP (17) — rather than wrist position alone (spec
 * section 8) or Euler angles (spec section 9's explicit "avoid
 * Euler-angle-only orientation" — quaternions compose without gimbal lock).
 *
 * Method: build an orthonormal basis (palmRight, palmForward, palmNormal)
 * from the three landmarks, then convert that basis directly into a
 * quaternion via the standard rotation-matrix-to-quaternion formula. This
 * is a real, general technique (not hand-specific magic) — it's the same
 * approach used for any "orient an object to match 3 tracked points."
 */
export function estimateHandOrientation(hand: HandObservation): Quaternion {
  const wrist = hand.landmarks[0];
  const indexMcp = hand.landmarks[5];
  const pinkyMcp = hand.landmarks[17];
  if (!wrist || !indexMcp || !pinkyMcp) return IDENTITY_QUATERNION;

  const toIndex = subtract(indexMcp, wrist);
  const toPinky = subtract(pinkyMcp, wrist);

  const palmNormal = normalize(cross(toIndex, toPinky));
  const palmForward = normalize(add(toIndex, toPinky));
  const palmRight = normalize(cross(palmForward, palmNormal));
  const orthoForward = normalize(cross(palmNormal, palmRight));

  return basisToQuaternion(palmRight, orthoForward, palmNormal);
}

function subtract(a: Landmark, b: Landmark): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function normalize(v: Vec3): Vec3 {
  const len = length(v);
  // Degenerate input (e.g. all three source landmarks coincide, which real
  // MediaPipe output should never produce but a malformed/synthetic frame
  // could) falls back to a fixed axis rather than dividing by zero — this
  // avoids NaN but does NOT guarantee a meaningful orientation in that
  // case; verified only that it fails safely, not that it fails "correctly."
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Standard orthonormal-basis-to-quaternion conversion (Shepperd's method,
 * numerically stable across all rotation ranges). */
function basisToQuaternion(right: Vec3, forward: Vec3, up: Vec3): Quaternion {
  const m00 = right.x, m01 = forward.x, m02 = up.x;
  const m10 = right.y, m11 = forward.y, m12 = up.y;
  const m20 = right.z, m21 = forward.z, m22 = up.z;

  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  return normalizeQuat({ x: qx, y: qy, z: qz, w: qw });
}

function normalizeQuat(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-8) return IDENTITY_QUATERNION;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}
