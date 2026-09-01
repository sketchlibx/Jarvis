// ---------------------------------------------------------------------
// Future spatial/holographic output devices — spec section 18.
// STATUS: INTERFACE-ONLY beyond the Camera AR case, which is Phase 5's
// REAL, already-tested `ARController`/`ARScene` — referenced here, not
// duplicated or modified. This file does not change one line of Phase 5;
// `ARController.ts`, `ARScene.ts`, `DesignGraph.ts` are untouched.
// ---------------------------------------------------------------------

import type { DesignGraph } from "../design3d/scene/DesignGraph";

export type SpatialOutputDeviceType = "camera_ar" | "depth_camera" | "projector" | "spatial_display" | "holographic";

export interface SpatialOutputCapabilities {
  deviceType: SpatialOutputDeviceType;
  supportsHandTracking: boolean;
  supportsDepthSensing: boolean;
  supportsMultiUser: boolean;
}

/**
 * A device that can render a `DesignGraph` in physical/spatial space.
 * `CameraARSpatialOutput` (below) is the only real implementation, and it
 * is a thin wrapper around Phase 5's existing, already-verified
 * `ARController` — it does not reimplement anchoring, gesture handling,
 * or rendering.
 */
export interface SpatialOutputProvider {
  readonly deviceType: SpatialOutputDeviceType;
  isAvailable(): boolean;
  getCapabilities(): SpatialOutputCapabilities;
  attachDesignGraph(graph: DesignGraph): void;
}

/** Camera AR — the one REAL device type, wrapping Phase 5's untouched
 * `ARController`. Adds nothing to how AR actually works; only exposes
 * Phase 5's existing capabilities through this generic shape. */
export class CameraARSpatialOutput implements SpatialOutputProvider {
  readonly deviceType: SpatialOutputDeviceType = "camera_ar";

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  getCapabilities(): SpatialOutputCapabilities {
    return { deviceType: "camera_ar", supportsHandTracking: true, supportsDepthSensing: false, supportsMultiUser: false };
  }

  attachDesignGraph(_graph: DesignGraph): void {
    // Deliberately a no-op stub at this abstraction layer — actually
    // attaching a DesignGraph to Phase 5's AR pipeline is
    // `ARController`'s constructor parameter, which callers should use
    // directly (see `ARView.tsx`). ARController already owns that
    // responsibility and this class must not duplicate it.
  }
}

/** Placeholder for every device type that doesn't exist yet. Honestly
 * reports unavailable rather than pretending to support hardware nobody
 * has built support for. */
export class UnimplementedSpatialOutput implements SpatialOutputProvider {
  constructor(public readonly deviceType: SpatialOutputDeviceType) {}
  isAvailable(): boolean { return false; }
  getCapabilities(): SpatialOutputCapabilities {
    return { deviceType: this.deviceType, supportsHandTracking: false, supportsDepthSensing: false, supportsMultiUser: false };
  }
  attachDesignGraph(): void {
    throw new Error(`${this.deviceType} output is not implemented yet.`);
  }
}
