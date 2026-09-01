import React from "react";

export interface StatusBarProps {
  online: boolean;
  aiAvailable: boolean;
  micStatus: "unavailable" | "permission_denied" | "idle" | "listening" | "processing" | "error";
  cameraStatus: "unavailable" | "permission_denied" | "off" | "starting" | "on" | "error";
  currentTask?: string;
  /** Phase 2 additions — all optional so Phase 1 call sites keep compiling. */
  browserActive?: boolean;
  activeApplication?: string;
  fileOperationStatus?: string;
  /** Phase 3 */
  speaking?: boolean;
}

function Dot({ label, active, error }: { label: string; active: boolean; error?: boolean }) {
  const cls = error ? "status-dot status-dot--error" : active ? "status-dot status-dot--active" : "status-dot";
  return (
    <div className={cls}>
      <span className="status-dot__indicator" />
      <span>{label}</span>
    </div>
  );
}

/** Spec section 7 requires these six states to be distinguishable at a
 * glance: MIC OFF, MIC READY, LISTENING, PROCESSING, SPEAKING, ERROR. */
function micLabel(status: StatusBarProps["micStatus"], speaking: boolean): string {
  if (status === "error" || status === "permission_denied") return "MIC ERROR";
  if (status === "unavailable") return "MIC OFF";
  if (speaking) return "SPEAKING";
  if (status === "listening") return "LISTENING";
  if (status === "processing") return "PROCESSING";
  return "MIC READY";
}

export function StatusBar({
  online, aiAvailable, micStatus, cameraStatus, currentTask,
  browserActive, activeApplication, fileOperationStatus, speaking,
}: StatusBarProps) {
  return (
    <div className="glass-panel status-bar">
      <div className="status-bar__title">JARVIS</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 10 }}>
        <span>{currentTask ?? "Idle"}</span>
        {activeApplication && <span style={{ color: "var(--accent-cyan)" }}>· {activeApplication}</span>}
        {fileOperationStatus && <span>· {fileOperationStatus}</span>}
      </div>
      <div className="status-cluster">
        <Dot label="Network" active={online} />
        <Dot label="AI" active={aiAvailable} error={!aiAvailable} />
        <Dot
          label={micLabel(micStatus, !!speaking)}
          active={micStatus === "listening" || micStatus === "processing" || !!speaking}
          error={micStatus === "error" || micStatus === "permission_denied"}
        />
        <Dot label="Camera" active={cameraStatus === "on" || cameraStatus === "starting"} error={cameraStatus === "error" || cameraStatus === "permission_denied"} />
        {browserActive !== undefined && <Dot label="Browser" active={browserActive} />}
      </div>
    </div>
  );
}
