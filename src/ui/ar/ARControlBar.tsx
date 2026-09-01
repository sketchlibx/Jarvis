import React from "react";
import type { TrackingState } from "../../ar/types";

interface Props {
  arEnabled: boolean;
  onToggleAR: () => void;
  selectedObjectName: string | null;
  trackingState: TrackingState;
  currentGesture: string | null;
  onOpenCalibration: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
}

function trackingBadgeClass(state: TrackingState): string {
  if (state === "TRACKING") return "ar-badge ar-badge--tracking";
  if (state === "DEGRADED") return "ar-badge ar-badge--degraded";
  if (state === "LOST") return "ar-badge ar-badge--lost";
  return "ar-badge";
}

/** Keeps the JARVIS glass-panel visual language; positioned to never cover
 * the center of the camera view (spec section 40's explicit requirement),
 * living in a thin strip along the top instead. */
export function ARControlBar({
  arEnabled, onToggleAR, selectedObjectName, trackingState, currentGesture, onOpenCalibration, debugMode, onToggleDebug,
}: Props) {
  return (
    <div className="glass-panel ar-control-bar">
      <button className="studio-toolbar-btn studio-toolbar-btn--nav" onClick={onToggleAR}>
        AR {arEnabled ? "ON" : "OFF"}
      </button>
      {arEnabled && (
        <>
          <span className="ar-badge">{selectedObjectName ?? "no selection"}</span>
          <span className={trackingBadgeClass(trackingState)}>{trackingState}</span>
          {currentGesture && <span className="ar-badge">{currentGesture}</span>}
          <button className="studio-toolbar-btn" onClick={onOpenCalibration}>Calibration</button>
          <button
            className="studio-toolbar-btn"
            onClick={onToggleDebug}
            style={{ color: debugMode ? "var(--accent-cyan)" : undefined, marginLeft: "auto" }}
          >
            Debug
          </button>
        </>
      )}
    </div>
  );
}
