import React from "react";
import type { ARControllerStats } from "../../ar/ARController";
import type { VisionPipelineStats } from "../../types/perception";

interface Props {
  stats: ARControllerStats;
  visionStats: VisionPipelineStats | null;
  coordinateMappingReady: boolean;
}

export function ARDebugOverlay({ stats, visionStats, coordinateMappingReady }: Props) {
  return (
    <div className="glass-panel ar-debug-overlay">
      <div>camera fps: <span style={{ color: "var(--text-primary)" }}>{visionStats?.cameraFps ?? "—"}</span></div>
      <div>vision fps: <span style={{ color: "var(--text-primary)" }}>{visionStats?.visionFps ?? "—"}</span></div>
      <div>hands: <span style={{ color: "var(--text-primary)" }}>{stats.handsDetected}</span></div>
      <div>tracking: <span style={{ color: "var(--text-primary)" }}>{stats.trackingState}</span></div>
      <div>instances: <span style={{ color: "var(--text-primary)" }}>{stats.activeInstances}</span></div>
      <div>selected: <span style={{ color: "var(--text-primary)" }}>{stats.selectedInstanceId ?? "—"}</span></div>
      <div>coord mapping: <span style={{ color: coordinateMappingReady ? "var(--safe)" : "var(--danger)" }}>{coordinateMappingReady ? "ready" : "not ready"}</span></div>
      <div>hands model: <span style={{ color: visionStats?.handsInitialized ? "var(--safe)" : "var(--text-muted)" }}>{visionStats?.handsInitialized ? "loaded" : "not loaded"}</span></div>
    </div>
  );
}
