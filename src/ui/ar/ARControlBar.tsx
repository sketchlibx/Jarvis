import type { TrackingState, ARInteractionMode } from "../../ar/types";

interface Props {
  arEnabled: boolean;
  onToggleAR: () => void;
  selectedObjectName: string | null;
  trackingState: TrackingState;
  currentGesture: string | null;
  /** Real per-instance interactionMode for the current selection (see
   * ARController.getStats()) — null when nothing is selected. Renders as
   * a badge only when there's something meaningful to say (GRABBING/
   * TWO_HAND_TRANSFORMING); IDLE/HOVER don't need their own badge. */
  interactionMode: ARInteractionMode | null;
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

function interactionBadgeClass(mode: ARInteractionMode): string {
  if (mode === "GRABBING") return "ar-badge ar-badge--grabbing";
  if (mode === "TWO_HAND_TRANSFORMING") return "ar-badge ar-badge--transforming";
  return "ar-badge";
}

/** Keeps the JARVIS glass-panel visual language; positioned to never cover
 * the center of the camera view (spec section 40's explicit requirement),
 * living in a thin strip along the top instead. */
export function ARControlBar({
  arEnabled, onToggleAR, selectedObjectName, trackingState, currentGesture, interactionMode, onOpenCalibration, debugMode, onToggleDebug,
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
          {interactionMode && interactionMode !== "IDLE" && interactionMode !== "HOVER" && (
            <span className={interactionBadgeClass(interactionMode)}>{interactionMode.replace(/_/g, " ")}</span>
          )}
          <button className="studio-toolbar-btn" onClick={onOpenCalibration}>Calibration</button>
          <button
            className={`studio-toolbar-btn ${debugMode ? "studio-toolbar-btn--active" : ""}`}
            onClick={onToggleDebug}
            style={{ marginLeft: "auto" }}
          >
            Debug
          </button>
        </>
      )}
    </div>
  );
}
