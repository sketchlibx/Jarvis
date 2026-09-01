import React from "react";

interface Props {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onReset: () => void;
  onResetCamera: () => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  onExit: () => void;
  /** Undefined entirely (not just disabled) when no camera stream is
   * available yet — a missing prop is a clearer signal than a disabled
   * button with no explanation for why AR can't be reached from here. */
  onToggleAR?: () => void;
  arAvailable: boolean;
}

export function StudioTopBar(props: Props) {
  return (
    <div className="glass-panel studio-toolbar studio-top">
      <button className="studio-toolbar-btn studio-toolbar-btn--nav" onClick={props.onExit}>← Assistant</button>
      <input
        value={props.projectName}
        onChange={(e) => props.onProjectNameChange(e.target.value)}
        style={{ background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 13, fontWeight: 600, flex: 1 }}
      />
      <button className="studio-toolbar-btn" onClick={props.onSave}>Save</button>
      <button className="studio-toolbar-btn" onClick={props.onUndo} disabled={!props.canUndo}>Undo</button>
      <button className="studio-toolbar-btn" onClick={props.onRedo} disabled={!props.canRedo}>Redo</button>
      <button className="studio-toolbar-btn" onClick={props.onReset}>Reset</button>
      <button className="studio-toolbar-btn" onClick={props.onResetCamera}>Reset Camera</button>
      <button className="studio-toolbar-btn" onClick={props.onToggleWireframe} style={{ color: props.wireframe ? "var(--accent-cyan)" : undefined }}>
        Wireframe
      </button>
      {props.arAvailable && props.onToggleAR && (
        <button className="studio-toolbar-btn studio-toolbar-btn--nav" onClick={props.onToggleAR}>AR</button>
      )}
    </div>
  );
}
