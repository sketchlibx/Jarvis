import React from "react";
import type { MicStatus } from "../../types/voice";

export interface StatusBarProps {
  online: boolean;
  aiAvailable: boolean;
  micStatus: MicStatus;
  cameraStatus: "unavailable" | "permission_denied" | "off" | "starting" | "on" | "error";
  currentTask?: string;
  /** Phase 2 additions — all optional so Phase 1 call sites keep compiling. */
  browserActive?: boolean;
  activeApplication?: string;
  fileOperationStatus?: string;
  /** Phase 3 */
  speaking?: boolean;
  /** Phase 7 productization pass — closes the "top bar" gap from
   * PHASE-CONTINUITY.md by EXTENDING this existing component (spec's
   * repeated instruction: reuse/extend, do not create a second UI shell)
   * rather than building a parallel top-bar component. All optional so
   * every existing call site (if any) keeps compiling unchanged. */
  activeProviderName?: string;
  onOpenSettings?: () => void;
  onOpenDashboard?: () => void;
  onOpenDesignStudio?: () => void;
  onOpenDiagnostics?: () => void;
  onAskScreen?: () => void;
  onShareScreen?: () => void;
  onToggleDebug?: () => void;
  debugActive?: boolean;
  /** Which top-level screen is currently showing — drives the pill nav's
   * active-state highlight (reference screenshots show "Home" highlighted
   * while on that screen). */
  currentView?: "home" | "dashboard";
  /** Text-based command entry — the SAME `routeVoiceCommand` a real STT
   * transcript would feed (see voice/CommandRouter.ts), given as a real,
   * always-available input rather than only a hidden test scaffold. This
   * is also the honest way to exercise "voice command routing" in an
   * environment (like this sandbox) where microphone hardware can't be
   * verified — the ROUTING is real and tested either way; only the audio
   * capture step differs. */
  onCommandText?: (text: string) => void;
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
  if (status === "starting") return "LISTENING"; // real state, shown identically to LISTENING — the "starting" phase is milliseconds long and not worth a distinct label
  if (status === "processing") return "PROCESSING";
  return "MIC READY";
}

export function StatusBar({
  online, aiAvailable, micStatus, cameraStatus, currentTask,
  browserActive, activeApplication, fileOperationStatus, speaking,
  activeProviderName, onOpenSettings, onOpenDashboard, onOpenDesignStudio, onOpenDiagnostics, onAskScreen, onShareScreen, onToggleDebug, debugActive, onCommandText,
  currentView = "home",
}: StatusBarProps) {
  const [commandInput, setCommandInput] = React.useState("");
  // Redesign (per the reference screenshots): a small corner gear for
  // Settings, a centered pill nav for the app's real top-level screens,
  // and everything else (the six-dot cluster, task/app/file-operation
  // text, provider badge, raw command-text input, Debug) behind a details
  // disclosure — same functionality as before, still not shown by default.
  const [expanded, setExpanded] = React.useState(false);
  const hasDetail = !!(currentTask || activeApplication || fileOperationStatus || activeProviderName || onCommandText || onToggleDebug);
  const overallOk = online && aiAvailable && micStatus !== "error" && micStatus !== "permission_denied" && cameraStatus !== "error" && cameraStatus !== "permission_denied";

  return (
    <div className="glass-panel status-bar">
      <div className="status-bar__row">
        {onOpenSettings && <button className="status-bar__corner-icon" title="Settings" onClick={onOpenSettings}>⚙</button>}

        <nav className="status-bar__pillnav">
          <span className={`status-bar__pill ${currentView === "home" ? "status-bar__pill--active" : ""}`}>⌂ Home</span>
          {onOpenDashboard && (
            <button
              className={`status-bar__pill status-bar__pill--btn ${currentView === "dashboard" ? "status-bar__pill--active" : ""}`}
              onClick={onOpenDashboard}
            >
              ▦ Dashboard
            </button>
          )}
          {onOpenDesignStudio && <button className="status-bar__pill status-bar__pill--btn" onClick={onOpenDesignStudio}>◈ 3D Viewport</button>}
        </nav>

        <div className="status-bar__spacer" />
        <Dot label={overallOk ? "Nominal" : "Attention"} active={overallOk} error={!overallOk} />
        {onShareScreen && <button className="status-bar__icon-btn" title="Share live screen" onClick={onShareScreen}>▣</button>}
        {onOpenDiagnostics && <button className="status-bar__icon-btn" title="Diagnostics" onClick={onOpenDiagnostics}>⌁</button>}
        {hasDetail && (
          <button
            className={`status-bar__icon-btn ${expanded ? "status-bar__icon-btn--active" : ""}`}
            title="Details"
            onClick={() => setExpanded((v) => !v)}
          >
            ⋯
          </button>
        )}
      </div>

      {expanded && (
        <div className="status-bar__detail">
          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 10 }}>
            <span>{currentTask ?? "Idle"}</span>
            {activeApplication && <span style={{ color: "var(--accent-cyan)" }}>· {activeApplication}</span>}
            {fileOperationStatus && <span>· {fileOperationStatus}</span>}
          </div>
          <div className="status-cluster">
            <Dot label="Network" active={online} />
            <Dot label="AI" active={aiAvailable} error={!aiAvailable} />
            {activeProviderName && <span className="status-bar__provider">{activeProviderName}</span>}
            <Dot
              label={micLabel(micStatus, !!speaking)}
              active={micStatus === "listening" || micStatus === "starting" || micStatus === "processing" || !!speaking}
              error={micStatus === "error" || micStatus === "permission_denied"}
            />
            <Dot label="Camera" active={cameraStatus === "on" || cameraStatus === "starting"} error={cameraStatus === "error" || cameraStatus === "permission_denied"} />
            {browserActive !== undefined && <Dot label="Browser" active={browserActive} />}
          {onAskScreen && <button className="status-bar__nav-btn" onClick={onAskScreen}>Ask Screen</button>}
          {onOpenDiagnostics && <button className="status-bar__nav-btn" onClick={onOpenDiagnostics}>Diagnostics</button>}
          </div>
          {(onCommandText || onToggleDebug) && (
            <nav className="status-bar__nav">
              {onCommandText && (
                <input
                  className="status-bar__command-input"
                  placeholder='Type a command… (e.g. "open settings")'
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commandInput.trim()) {
                      onCommandText(commandInput);
                      setCommandInput("");
                    }
                  }}
                />
              )}
              {onToggleDebug && <button className={`status-bar__nav-btn ${debugActive ? "status-bar__nav-btn--active" : ""}`} onClick={onToggleDebug}>Debug</button>}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
