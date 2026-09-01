import type { Landmark } from "../types/perception";
import type { Vec3 } from "../design3d/types";

/**
 * # THE single coordinate conversion layer — spec section 4/5.
 *
 * Every place in this codebase that needs to turn a normalized MediaPipe
 * landmark (x,y,z ∈ roughly [0,1] for x/y, relative depth for z) into a
 * Three.js scene-space position MUST go through this class. There is
 * deliberately no second "1 - x" or "-1 + 2*x" conversion anywhere else —
 * grep for `CoordinateMapper` if you're tempted to add one.
 *
 * ## Why mirroring matters here specifically
 * `CameraPanel`'s video/canvas are mirrored via CSS `scaleX(-1)` (Phase 3)
 * purely for DISPLAY — so the user sees themselves like a mirror. MediaPipe
 * itself receives and returns UN-mirrored coordinates (it processes the raw
 * camera frame, before any CSS transform is applied). If the AR 3D overlay
 * used raw MediaPipe x-coordinates directly while the video underneath is
 * CSS-mirrored, the virtual object would visually drift in the opposite
 * direction from the user's real hand — the exact bug this class exists to
 * prevent. This class mirrors the X axis ONCE, here, so that everything
 * downstream (anchors, AR objects, pointer rays) is already in
 * display-correct space and nothing else needs to think about mirroring
 * again.
 *
 * ## Depth honesty (spec section 24)
 * MediaPipe's landmark `z` is a relative, unitless depth cue (roughly:
 * smaller/more-negative = closer to camera, scaled similarly to x/y) —
 * NOT a metric measurement. `mapToWorld`'s z output is explicitly labeled
 * `estimatedDepth`, and nothing in this codebase should render UI text
 * claiming "N centimeters" from it.
 */
export interface ViewportInfo {
  width: number;
  height: number;
  /** Three.js PerspectiveCamera.fov, in degrees. */
  verticalFovDegrees: number;
  /** Distance along -Z (into the screen) at which normalized coordinates
   * are projected — i.e. how far "into" the AR scene x/y=0..1 maps to.
   * Larger values spread objects across a wider world-space area for the
   * same normalized input, matching a hand held closer to vs. farther
   * from the camera without any real depth sensor. */
  projectionDistance: number;
}

export interface MappedPoint {
  world: Vec3;
  estimatedDepth: number; // echoes the input z, explicitly NOT metric — see class doc comment
}

export class CoordinateMapper {
  constructor(private viewport: ViewportInfo) {}

  updateViewport(viewport: Partial<ViewportInfo>): void {
    this.viewport = { ...this.viewport, ...viewport };
  }

  /**
   * Converts one normalized MediaPipe landmark (x,y ∈ [0,1], y-down, origin
   * top-left — MediaPipe's convention) into a Three.js world position
   * (x-right, y-up, origin at scene center, z into/out of screen).
   *
   * Steps, in order (this exact order matters — see class doc comment for why):
   * 1. Mirror X: `mirroredX = 1 - x` (undoes the CSS mirror so AR content
   *    lines up with what the user visually sees).
   * 2. Center: shift from [0,1] to [-0.5, 0.5] on both axes.
   * 3. Flip Y: MediaPipe is y-down, Three.js/screen-space-in-3D is
   *    conventionally y-up, so `-y`.
   * 4. Scale by the camera's field of view at `projectionDistance`, so
   *    normalized coordinates map to a world-space frustum slice
   *    consistent with the actual viewport aspect ratio — not a
   *    fixed/arbitrary scale that would drift if the window is resized.
   */
  mapToWorld(landmark: Landmark): MappedPoint {
    const mirroredX = 1 - landmark.x;
    const centeredX = mirroredX - 0.5;
    const centeredY = -(landmark.y - 0.5);

    const aspect = this.viewport.width / Math.max(this.viewport.height, 1);
    const vFovRad = (this.viewport.verticalFovDegrees * Math.PI) / 180;
    const halfHeightAtDistance = Math.tan(vFovRad / 2) * this.viewport.projectionDistance;
    const halfWidthAtDistance = halfHeightAtDistance * aspect;

    return {
      world: {
        x: centeredX * 2 * halfWidthAtDistance,
        y: centeredY * 2 * halfHeightAtDistance,
        z: -this.viewport.projectionDistance, // negative Z = "into the screen" in Three.js's default camera-forward convention
      },
      estimatedDepth: landmark.z,
    };
  }

  /** Convenience for a plain {x,y} normalized point (e.g. a pointer ray
   * screen target) rather than a full Landmark with z. */
  mapPoint2D(normalizedX: number, normalizedY: number): Vec3 {
    return this.mapToWorld({ x: normalizedX, y: normalizedY, z: 0 }).world;
  }
}
