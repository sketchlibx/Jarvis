import type { PlanReport } from "../../types/tool";

interface Props {
  plan: PlanReport;
  onCancel: () => void;
  running: boolean;
}

export function TaskProgress({ plan, onCancel, running }: Props) {
  const pct = plan.total_steps === 0 ? 0 : Math.round((plan.completed_steps / plan.total_steps) * 100);

  return (
    <div className="glass-panel task-progress">
      <div className="task-progress__header">
        <span className="task-progress__label">Task Progress</span>
        {running && (
          <button className="task-progress__cancel" onClick={onCancel}>Cancel</button>
        )}
      </div>

      <div className="task-progress__bar">
        <div
          className="task-progress__bar-fill"
          style={{ width: `${pct}%`, background: plan.stopped_early && !running ? "var(--warning)" : "var(--accent-cyan)" }}
        />
      </div>

      <div className="task-progress__summary">{plan.summary}</div>

      {plan.outcomes.map((o, i) => (
        <div key={i} className="task-progress__outcome">
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
