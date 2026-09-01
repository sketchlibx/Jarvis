import type { ScreenCaptureCapabilities, ScreenCaptureMode, ScreenCapturePermissionState, ScreenCaptureProvider, ScreenFrame } from "./ScreenCaptureProvider";

/**
 * # Status: UNVERIFIED (no browser/display available in this sandbox).
 *
 * Real `getDisplayMedia()` usage — the standard browser API for screen
 * capture (works inside a Tauri WebView the same as any other browser
 * context). `active_window`/`selected_monitor`/`full_screen` all resolve
 * to the SAME underlying browser call; the distinction is which choice
 * the user makes in the browser's own picker UI, which JS cannot control
 * or bypass (spec section 24's "screen capture without permission" test is
 * structurally satisfied because the browser's own picker IS the
 * permission prompt — there's no code path that skips it).
 *
 * Only ONE frame is pulled per `capture()` call, then the stream is
 * stopped immediately — this deliberately does NOT keep a live screen
 * share running between calls (spec section 12: "do NOT make continuous
 * capture automatically enabled").
 */
export class WebScreenCaptureProvider implements ScreenCaptureProvider {
  private permission: ScreenCapturePermissionState = { granted: false, deniedAt: null };
  private activeStream: MediaStream | null = null;

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  }

  getCapabilities(): ScreenCaptureCapabilities {
    return {
      screenshotSupported: this.isAvailable(),
      activeWindowSupported: this.isAvailable(),
      selectedMonitorSupported: this.isAvailable(),
      fullScreenSupported: this.isAvailable(),
      continuousCaptureSupported: false,
    };
  }

  getPermissionState(): ScreenCapturePermissionState {
    return this.permission;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      this.permission = { granted: true, deniedAt: null };
      return true;
    } catch {
      this.permission = { granted: false, deniedAt: new Date().toISOString() };
      return false;
    }
  }

  async capture(mode: ScreenCaptureMode): Promise<ScreenFrame> {
    if (!this.isAvailable()) throw new Error("Screen capture is not available in this environment.");

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    this.activeStream = stream;
    this.permission = { granted: true, deniedAt: null };

    try {
      const track = stream.getVideoTracks()[0];
      const hasImageCapture = typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture !== "undefined";
      let bitmap: ImageBitmap;
      if (hasImageCapture) {
        const ImageCaptureCtor = (window as unknown as { ImageCapture: new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
        bitmap = await new ImageCaptureCtor(track).grabFrame();
      } else {
        bitmap = await grabFrameViaVideoElement(stream);
      }

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not acquire a 2D canvas context to encode the captured frame.");
      ctx.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const imageBase64 = dataUrl.split(",")[1] ?? "";

      return {
        imageBase64,
        mimeType: "image/png",
        capturedAt: new Date().toISOString(),
        mode,
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      this.stop();
    }
  }

  stop(): void {
    this.activeStream?.getTracks().forEach((t) => t.stop());
    this.activeStream = null;
  }
}

async function grabFrameViaVideoElement(stream: MediaStream): Promise<ImageBitmap> {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  await new Promise((resolve) => { video.onloadedmetadata = resolve; });
  const bitmap = await createImageBitmap(video);
  video.pause();
  video.srcObject = null;
  return bitmap;
}
