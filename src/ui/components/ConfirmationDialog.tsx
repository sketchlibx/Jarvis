import React, { useEffect } from "react";
import type { ConfirmationExplanation } from "../../types/tool";

interface Props {
  explanation: ConfirmationExplanation;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional: wire voice "confirm"/"cancel" transcript matches here. */
  voiceTranscript?: string;
}

export function ConfirmationDialog({ explanation, onConfirm, onCancel, voiceTranscript }: Props) {
  useEffect(() => {
    if (!voiceTranscript) return;
    const t = voiceTranscript.trim().toLowerCase();
    if (t === "confirm") onConfirm();
    else if (t === "cancel") onCancel();
  }, [voiceTranscript, onConfirm, onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const riskClass = explanation.risk === "CRITICAL" ? "confirm-card--critical" : "confirm-card--high";
  const badgeClass = explanation.risk === "CRITICAL" ? "confirm-risk-badge--critical" : "confirm-risk-badge--high";

  return (
    <div className="confirm-backdrop" role="alertdialog" aria-modal="true">
      <div className={`confirm-card ${riskClass}`}>
        <span className={`confirm-risk-badge ${badgeClass}`}>{explanation.risk}</span>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{explanation.action}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
          Target: {explanation.target}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{explanation.what_will_happen}</div>
        {(explanation.risk === "CRITICAL") && (
          <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 10 }}>
            This action may be irreversible.
          </div>
        )}
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--cancel" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn--confirm" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
