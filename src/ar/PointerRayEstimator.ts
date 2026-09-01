import type { HandObservation } from "../types/perception";
import type { Vec3 } from "../design3d/types";
import { CoordinateMapper } from "./CoordinateMapper";

export interface PointerRay {
  origin: Vec3;
  direction: Vec3; // normalized
}

/**
 * Builds a ray from index MCP (5) through index PIP (6) to index TIP (8),
 * per spec section 22. Used for future "point at the gauntlet" style
 * interaction — this file only produces the ray; actual ray-object
 * intersection is `GraphRenderer.raycastSelect`'s job (Phase 4, reused
 * here rather than duplicated) once the ray is converted to Three.js's
 * own Raycaster inputs by the caller.
 */
export function estimatePointerRay(hand: HandObservation, mapper: CoordinateMapper): PointerRay | null {
  const mcp = hand.landmarks[5];
  const pip = hand.landmarks[6];
  const tip = hand.landmarks[8];
  if (!mcp || !pip || !tip) return null;

  // Use MCP->TIP directly for the ray direction (PIP included in the
  // validity check above since a bent finger's PIP is still a signal we'd
  // want available for a future curvature-aware estimate, even though the
  // current direction calculation only needs the two endpoints).
  const originWorld = mapper.mapToWorld(mcp).world;
  const tipWorld = mapper.mapToWorld(tip).world;

  const dir = { x: tipWorld.x - originWorld.x, y: tipWorld.y - originWorld.y, z: tipWorld.z - originWorld.z };
  const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
  if (len < 1e-8) return null; // degenerate — finger tip coincides with MCP, no meaningful direction

  return {
    origin: originWorld,
    direction: { x: dir.x / len, y: dir.y / len, z: dir.z / len },
  };
}
