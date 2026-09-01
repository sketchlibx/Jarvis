import React from "react";
import type { StateEstimate } from "../../types/perception";

const STATE_PHRASING: Record<StateEstimate["state"], string> = {
  calm: "calm",
  focused: "focused",
  confused: "possibly confused",
  frustrated: "possibly frustrated",
  excited: "excited",
  uncertain: "uncertain",
  neutral: "neutral",
};

/**
 * Always renders the confidence number alongside the label — never a bare
 * assertion. Per spec section 16/40, perception is uncertain and the UI
 * must not let that get lost. Below the confidence threshold, this
 * component doesn't render a claim at all.
 */
export function StateIndicator({ estimate, enabled }: { estimate: StateEstimate | null; enabled: boolean }) {
  if (!enabled) return null;
  if (!estimate || estimate.confidence < 0.15) {
    return (
      <div className="state-indicator">
        <span className="state-indicator__pill" style={{ color: "var(--text-muted)" }}>reading…</span>
      </div>
    );
  }

  return (
    <div className="state-indicator" title={`Signals: ${estimate.signals.join(", ") || "none"}`}>
      <span className="state-indicator__pill">{STATE_PHRASING[estimate.state]}</span>
      <span className="state-indicator__confidence">{Math.round(estimate.confidence * 100)}% confidence</span>
    </div>
  );
}
