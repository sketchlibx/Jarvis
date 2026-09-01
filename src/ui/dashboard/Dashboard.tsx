import React, { useEffect, useState } from "react";
import { JarvisVisualizerView } from "./JarvisVisualizerView";
import type { JarvisStateMachine, JarvisState } from "../../orchestrator/JarvisStateMachine";
import type { ActivityLog, ActivityEntry } from "../../orchestrator/ActivityLog";

interface SystemStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  networkStatus: "online" | "offline" | "unknown";
}

interface Props {
  stateMachine: JarvisStateMachine;
  activityLog: ActivityLog;
  /** Real values only — spec section 8 lists CPU/Memory/Network as real
   * system panel fields, not decorative fake numbers. Pass nulls rather
   * than fabricated numbers if no real OS-stats source is wired up yet;
   * the panel renders "—" for null fields instead of a fake 0%. */
  systemStats: SystemStats;
}

const STATE_LABELS: Record<JarvisState, string> = {
  IDLE: "Idle", LISTENING: "Listening", THINKING: "Thinking", SPEAKING: "Speaking",
  EXECUTING: "Executing", WAITING_CONFIRMATION: "Waiting for confirmation", ERROR: "Error", OFFLINE: "Offline",
};

/**
 * Deliberately NOT a grid of generic glass stat cards (spec section 8's
 * explicit "avoid... meaningless statistics, generic SaaS dashboard
 * layouts"). The visualizer dominates vertical space in the center;
 * Activity and System sit as two narrow, text-forward columns below it.
 */
export function Dashboard({ stateMachine, activityLog, systemStats }: Props) {
  const [state, setState] = useState<JarvisState>(stateMachine.state);
  const [entries, setEntries] = useState<ActivityEntry[]>(activityLog.getEntries());

  useEffect(() => stateMachine.onTransition((e) => setState(e.state)), [stateMachine]);
  useEffect(() => activityLog.onChange(setEntries), [activityLog]);

  const latest = entries[entries.length - 1] ?? null;

  return (
    <div className="dashboard">
      <div className="dashboard-brand">J A R V I S</div>

      <div className="dashboard-visualizer-frame">
        <JarvisVisualizerView state={state} />
        <div className="dashboard-state-label">{STATE_LABELS[state]}</div>
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-column">
          <h3 className="dashboard-column-title">Activity</h3>
          {latest ? (
            <dl className="dashboard-facts">
              <dt>Request</dt><dd>{latest.requestText}</dd>
              <dt>Agent</dt><dd>{latest.providerName ?? "—"}</dd>
              <dt>Action</dt><dd>{latest.toolName ?? "—"}</dd>
              <dt>Status</dt><dd className={`status-${latest.status}`}>{latest.status.replace(/_/g, " ")}</dd>
              {latest.errorMessage && (<><dt>Error</dt><dd className="status-error">{latest.errorMessage}</dd></>)}
            </dl>
          ) : (
            <p className="dashboard-empty">No activity yet.</p>
          )}
        </section>

        <section className="dashboard-column">
          <h3 className="dashboard-column-title">System</h3>
          <dl className="dashboard-facts">
            <dt>CPU</dt><dd>{systemStats.cpuPercent !== null ? `${systemStats.cpuPercent}%` : "—"}</dd>
            <dt>Memory</dt><dd>{systemStats.memoryPercent !== null ? `${systemStats.memoryPercent}%` : "—"}</dd>
            <dt>Network</dt><dd className={systemStats.networkStatus === "online" ? "status-completed" : "status-error"}>{systemStats.networkStatus}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
