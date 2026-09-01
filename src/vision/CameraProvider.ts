import type { CameraStatus, VisionProvider } from "../types/vision";

/**
 * Real camera access via getUserMedia. No frame is ever captured or
 * processed until start() is called from an explicit, visible user action
 * — there is no code path that requests the camera on mount or in the
 * background (spec section 32 privacy requirement).
 */
export class CameraProvider implements VisionProvider {
  private status: CameraStatus = "off";
  private stream: MediaStream | null = null;
  private statusListeners = new Set<(s: CameraStatus) => void>();
  private selectedDeviceId: string | null = null;

  private setStatus(s: CameraStatus) {
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  getStatus(): CameraStatus {
    return this.status;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      this.setStatus("permission_denied");
      return false;
    }
  }

  async enumerateCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  selectCamera(deviceId: string): void {
    this.selectedDeviceId = deviceId;
  }

  async start(): Promise<void> {
    if (this.status === "on" || this.status === "starting") return;
    this.setStatus("starting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : true,
      });
      this.setStatus("on");
    } catch (err: any) {
      if (err?.name === "NotAllowedError") this.setStatus("permission_denied");
      else if (err?.name === "NotFoundError") this.setStatus("unavailable");
      else this.setStatus("error");
      throw err;
    }
  }

  async stop(): Promise<void> {
    // Explicit, correct stream release per spec section 31 — every track
    // is stopped, not just the reference dropped, so the OS camera
    // indicator light actually turns off.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.setStatus("off");
  }

  getPreviewStream(): MediaStream | null {
    return this.stream;
  }

  onStatusChange(cb: (status: CameraStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}
