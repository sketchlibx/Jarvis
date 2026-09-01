// ---------------------------------------------------------------------
// Screen capture / perception — spec sections 12-13. Architecture:
// Windows Screen -> ScreenCaptureProvider -> ScreenFrame -> ScreenPerception
// -> AI/JARVIS Orchestrator (fed in as a VISION-capability request, same
// provider-capability system Phase 6's routing already uses — screen
// frames are NOT a separate AI pathway).
// ---------------------------------------------------------------------

export type ScreenCaptureMode = "screenshot" | "active_window" | "selected_monitor" | "full_screen";

export interface ScreenFrame {
  /** Base64-encoded PNG/JPEG — same shape the existing `AIProvider`
   * vision-capable methods already expect for image input, so a
   * `ScreenFrame` can be handed to `provider.chat()` (or a future
   * vision-specific method) without a translation layer. */
  imageBase64: string;
  mimeType: "image/png" | "image/jpeg";
  capturedAt: string;
  mode: ScreenCaptureMode;
  width: number;
  height: number;
}

export interface ScreenCaptureCapabilities {
  screenshotSupported: boolean;
  activeWindowSupported: boolean;
  selectedMonitorSupported: boolean;
  fullScreenSupported: boolean;
  /** Always false for every implementation in this codebase today — see
   * spec section 12's "do NOT make continuous capture automatically
   * enabled" and `settings/types.ts`'s `continuousCaptureBlocked`, which
   * this capability flag exists to stay structurally consistent with. */
  continuousCaptureSupported: boolean;
}

export interface ScreenCapturePermissionState {
  granted: boolean;
  /** Null until the user has been asked at least once — distinguishes
   * "never asked" from "asked and denied." */
  deniedAt: string | null;
}

export interface ScreenCaptureProvider {
  isAvailable(): boolean;
  getCapabilities(): ScreenCaptureCapabilities;
  getPermissionState(): ScreenCapturePermissionState;
  /** Must prompt the user via the platform's real permission UI — never
   * silently grants itself. */
  requestPermission(): Promise<boolean>;
  /** Single explicit capture. Throws if permission hasn't been granted —
   * never captures silently in the background (spec section 24's security
   * test: "screen capture without permission"). */
  capture(mode: ScreenCaptureMode): Promise<ScreenFrame>;
  stop(): void;
}

/** Used when no capture backend is available at all — never silently
 * returns a blank/fabricated frame. */
export class NoScreenCaptureProvider implements ScreenCaptureProvider {
  isAvailable(): boolean { return false; }
  getCapabilities(): ScreenCaptureCapabilities {
    return { screenshotSupported: false, activeWindowSupported: false, selectedMonitorSupported: false, fullScreenSupported: false, continuousCaptureSupported: false };
  }
  getPermissionState(): ScreenCapturePermissionState { return { granted: false, deniedAt: null }; }
  async requestPermission(): Promise<boolean> { return false; }
  async capture(_mode: ScreenCaptureMode): Promise<ScreenFrame> { throw new Error("No screen capture provider is available."); }
  stop(): void {}
}
