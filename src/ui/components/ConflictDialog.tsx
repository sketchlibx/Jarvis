
import { useEffect } from "react";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="confirm-backdrop"
      role="alertdialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="confirm-card hud-frame confirm-card--info">
        <span className="confirm-risk-badge confirm-risk-badge--info">ALREADY EXISTS</span>
        <div className="confirm-card__action">{filename} already exists</div>
        <div className="confirm-card__body">Replace it, keep both by creating a copy, or cancel.</div>
        <div className="confirm-actions confirm-actions--wrap">
          <button className="confirm-btn confirm-btn--cancel" onClick={onCancel} autoFocus>Cancel</button>
          <button className="confirm-btn confirm-btn--info" onClick={onCopy}>Create Copy</button>
          <button className="confirm-btn confirm-btn--confirm" onClick={onReplace}>Replace</button>
        </div>
      </div>
    </div>
  );
}
