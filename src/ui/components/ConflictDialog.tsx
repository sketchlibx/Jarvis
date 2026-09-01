import React from "react";

interface Props {
  destination: string;
  onReplace: () => void;
  onCopy: () => void;
  onCancel: () => void;
}

/**
 * Shown whenever a filesystem tool returns a CONFLICT (destination_exists).
 * JARVIS never silently overwrites — this is the only path to replacing an
 * existing file, and choosing Replace still routes through the HIGH_RISK
 * `replace_file` tool + ConfirmationDialog afterward, it doesn't skip it.
 */
export function ConflictDialog({ destination, onReplace, onCopy, onCancel }: Props) {
  const filename = destination.split(/[\\/]/).pop() ?? destination;

  return (
    <div className="confirm-backdrop" role="alertdialog" aria-modal="true">
      <div className="confirm-card">
        <span className="confirm-risk-badge" style={{ background: "rgba(78,225,255,0.12)", color: "var(--accent-cyan)" }}>
          ALREADY EXISTS
        </span>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{filename} already exists</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Replace it, keep both by creating a copy, or cancel.
        </div>
        <div className="confirm-actions" style={{ flexWrap: "wrap" }}>
          <button className="confirm-btn confirm-btn--cancel" onClick={onCancel}>Cancel</button>
          <button
            className="confirm-btn"
            style={{ background: "rgba(78,225,255,0.15)", color: "var(--accent-cyan)" }}
            onClick={onCopy}
          >
            Create Copy
          </button>
          <button className="confirm-btn confirm-btn--confirm" onClick={onReplace}>Replace</button>
        </div>
      </div>
    </div>
  );
}
