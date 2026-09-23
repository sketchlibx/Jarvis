// ---------------------------------------------------------------------
// Phase B.4/B.5: "Can you see me?" must be answered from REAL runtime
// state (camera status, whether the vision model actually finished
// initializing, and what was genuinely detected) — never a hardcoded
// "I can see you" just because the camera component is mounted, and
// never routed to the general AI, which has no reliable way to know any
// of this and was observed answering "I cannot see you, as I do not have
// access to a camera" regardless of actual state. Deterministic and
// testable, mirroring this project's existing preference for
// deterministic answers over LLM guessing (CommandRouter, time/date).
// ---------------------------------------------------------------------

import type { CameraStatus } from "../types/vision";

export type VisionAvailability = "unknown" | "initializing" | "available" | "unavailable";

export interface VisionRuntimeState {
  cameraStatus: CameraStatus;
  visionAvailable: VisionAvailability;
  handsDetected: number;
  faceDetected: boolean;
}

const VISION_STATUS_QUERY_RE = /^(?:can you see me|can you see|do you have camera access|are you able to see me|do you have visual access)\??$/i;

export function isVisionStatusQuery(text: string): boolean {
  return VISION_STATUS_QUERY_RE.test(text.trim());
}

/** The deterministic spoken/displayed reply for an explicit "can you see
 * me?"-style question. Never claims detection beyond `state`. */
export function buildVisionStatusReply(state: VisionRuntimeState): string {
  if (state.cameraStatus === "permission_denied") {
    return "Camera access is unavailable because permission was denied.";
  }
  if (state.cameraStatus === "unavailable") {
    return "No camera is available on this device.";
  }
  if (state.cameraStatus === "off" || state.cameraStatus === "error") {
    return "The camera is not active.";
  }
  if (state.cameraStatus === "starting" || state.visionAvailable === "initializing") {
    return "The camera is starting up — one moment.";
  }
  if (state.visionAvailable !== "available") {
    return "The camera is active, but visual analysis is currently unavailable.";
  }
  if (state.handsDetected > 0 && state.faceDetected) {
    return `Yes, I can see the camera feed — I'm currently detecting ${state.handsDetected === 1 ? "a hand" : `${state.handsDetected} hands`} and a face.`;
  }
  if (state.handsDetected > 0) {
    return `Yes, I can see the camera feed — I'm currently detecting ${state.handsDetected === 1 ? "a hand" : `${state.handsDetected} hands`}.`;
  }
  if (state.faceDetected) {
    return "Yes, I can see the camera feed, including your face.";
  }
  return "Yes, I can see the camera feed, though I don't currently detect a hand or face in view.";
}

/**
 * A short, truthful status line injected into the AI system prompt
 * (Phase B.5) for every message — not just an exact "can you see me?"
 * match — so a differently-phrased question ("what do you see", "am I
 * visible") is still grounded in real state instead of the model
 * guessing or fabricating. Deliberately terse: this is context, not the
 * whole answer. Returns null when the camera has never been touched at
 * all (avoids cluttering every single prompt with "camera is off" noise
 * for a user who has never opened the camera panel).
 */
export function buildVisionContextForPrompt(state: VisionRuntimeState): string | null {
  if (state.cameraStatus === "off" && state.visionAvailable === "unknown") return null;

  if (state.cameraStatus === "permission_denied") {
    return "Vision status: camera permission was denied. You have no visual access — never claim to see the user.";
  }
  if (state.cameraStatus === "unavailable") {
    return "Vision status: no camera is available on this device. You have no visual access.";
  }
  if (state.cameraStatus === "off" || state.cameraStatus === "error") {
    return "Vision status: camera is currently off. You have no visual access right now.";
  }
  if (state.visionAvailable !== "available") {
    return "Vision status: camera is active but visual analysis (hand/face detection) is not available. You can confirm the camera feed exists, but you have no detected visual details to report.";
  }
  const details: string[] = [];
  if (state.handsDetected > 0) details.push(`${state.handsDetected} hand(s) detected`);
  if (state.faceDetected) details.push("a face is detected");
  return `Vision status: camera active, visual analysis available. Detected: ${details.length > 0 ? details.join(", ") : "no hand or face currently in view"}. Only reference what is listed here — never describe visual details beyond this.`;
}
