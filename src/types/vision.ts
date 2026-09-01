export type CameraStatus = "unavailable" | "permission_denied" | "off" | "starting" | "on" | "error";

export interface VisionProvider {
  getStatus(): CameraStatus;
  requestPermission(): Promise<boolean>;
  start(): Promise<void>;   // must only be called from an explicit, visible user action
  stop(): Promise<void>;
  getPreviewStream(): MediaStream | null;
  onStatusChange(cb: (status: CameraStatus) => void): () => void; // returns unsubscribe
  enumerateCameras(): Promise<MediaDeviceInfo[]>;
  selectCamera(deviceId: string): void;
}
