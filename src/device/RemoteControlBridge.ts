export type RemoteView = "assistant" | "dashboard" | "settings" | "design";

export type RemoteCommand =
  | { type: "send_text"; text: string }
  | { type: "open_view"; view: RemoteView }
  | { type: "start_listening" }
  | { type: "stop_listening" }
  | { type: "start_screen_capture" }
  | { type: "stop_screen_capture" };

export interface RemoteBridgeInfo {
  enabled: boolean;
  host: string;
  port: number;
  token: string;
  pair_url: string;
  /** RFC3339 timestamp — when the current token stops being accepted,
   * regardless of whether it's still typed/pasted correctly (Phase 7
   * security hardening: tokens are now session-bounded and rotatable). */
  expires_at: string;
  /** Aggregate count of failed-auth attempts against the bridge since it
   * was last started or the token was last rotated — surfaced so the
   * user can actually see if something has been probing it. */
  failed_attempts_recent: number;
}

export interface RemoteStatus {
  state: string;
  mic_status: string;
  camera_status: string;
  online: boolean;
  active_provider: string | null;
  updated_at: string;
}
