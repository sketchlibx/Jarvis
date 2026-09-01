import React from "react";
import type { PlanReport } from "../../types/tool";

interface Props {
  plan: PlanReport;
  onCancel: () => void;
  running: boolean;
}

export function TaskProgress({ plan, onCancel, running }: Props) {
  const pct = plan.total_steps === 0 ? 0 : Math.round((plan.completed_steps / plan.total_steps) * 100);

  return (
    <div className="glass-panel" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Task Progress
        </span>
        {running && (
          <button
            onClick={onCancel}
            style={{
              background: "rgba(255,92,92,0.12)",
              color: "var(--danger)",
              border: "1px solid rgba(255,92,92,0.3)",
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: plan.stopped_early && !running ? "var(--warning)" : "var(--accent-cyan)",
            transition: "width 200ms ease",
          }}
        />
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-primary)" }}>{plan.summary}</div>

      {plan.outcomes.map((o, i) => (
        <div key={i} style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: 6 }}>
          <span>{i + 1}.</span>
          <span>{describeOutcome(o)}</span>
        </div>
      ))}
    </div>
  );
}

function describeOutcome(o: PlanReport["outcomes"][number]): string {
  switch (o.status) {
    case "Success": return o.message;
    case "NeedsConfirmation": return `Waiting for confirmation: ${o.explanation.action}`;
    case "Conflict": return `${o.destination} already exists — needs a decision`;
    case "Failed": return `Failed: ${o.error}`;
    case "Cancelled": return "Cancelled";
    case "Skipped": return "Skipped";
  }
}
