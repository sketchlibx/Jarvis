import React from "react";
import type { VisionPipelineStats, GestureLabel, StateEstimate } from "../../types/perception";

interface Props {
  stats: VisionPipelineStats | null;
  handsCount: number;
  faceDetected: boolean;
  poseDetected: boolean;
  gesture: GestureLabel | null;
  gestureConfidence: number | null;
  state: StateEstimate | null;
  eventRate: number; // events/sec observed on the EventBus
}

/**
 * Minimized/collapsed by default per spec section 31 ("debug mode should
 * be disabled or minimized in normal UI") — the parent (App.tsx) controls
 * visibility via a toggle, this component just renders the numbers when shown.
 */
export function DebugPanel({ stats, handsCount, faceDetected, poseDetected, gesture, gestureConfidence, state, eventRate }: Props) {
  return (
    <div className="glass-panel" style={{ padding: "10px 14px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px 16px" }}>
      <div>camera fps: <span style={{ color: "var(--text-primary)" }}>{stats?.cameraFps ?? "—"}</span></div>
      <div>vision fps: <span style={{ color: "var(--text-primary)" }}>{stats?.visionFps ?? "—"}</span></div>
      <div>hands: <span style={{ color: "var(--text-primary)" }}>{handsCount}</span></div>
      <div>face: <span style={{ color: "var(--text-primary)" }}>{faceDetected ? "detected" : "—"}</span></div>
      <div>pose: <span style={{ color: "var(--text-primary)" }}>{poseDetected ? "detected" : "—"}</span></div>
      <div>gesture: <span style={{ color: "var(--text-primary)" }}>{gesture ?? "—"}{gestureConfidence != null ? ` (${gestureConfidence.toFixed(2)})` : ""}</span></div>
      <div>state: <span style={{ color: "var(--text-primary)" }}>{state ? `${state.state} (${state.confidence.toFixed(2)})` : "—"}</span></div>
      <div>event rate: <span style={{ color: "var(--text-primary)" }}>{eventRate.toFixed(1)}/s</span></div>
      <div>hands model: <span style={{ color: stats?.handsInitialized ? "var(--safe)" : "var(--text-muted)" }}>{stats?.handsInitialized ? "loaded" : "not loaded"}</span></div>
      <div>face model: <span style={{ color: stats?.faceInitialized ? "var(--safe)" : "var(--text-muted)" }}>{stats?.faceInitialized ? "loaded" : "not loaded"}</span></div>
      <div>pose model: <span style={{ color: stats?.poseInitialized ? "var(--safe)" : "var(--text-muted)" }}>{stats?.poseInitialized ? "loaded" : "not loaded"}</span></div>
    </div>
  );
}
