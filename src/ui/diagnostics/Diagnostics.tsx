import { useMemo } from "react";
import type { ActivityEntry } from "../../orchestrator/ActivityLog";

interface Props { entries: ActivityEntry[]; onBack: () => void; onClear: () => void; onSave: () => void; }

export function Diagnostics({ entries, onBack, onClear, onSave }: Props) {
  const recent = useMemo(() => [...entries].reverse(), [entries]);
  return <section className="diagnostics-page">
    <header className="diagnostics-head">
      <div><span className="diagnostics-kicker">JARVIS / SYSTEM DIAGNOSTICS</span><h1>Neural Event Log</h1><p>Real application events with sensitive values redacted.</p></div>
      <div className="diagnostics-actions"><button onClick={onBack}>Back</button><button onClick={onClear}>Clear</button><button className="diagnostics-save" onClick={onSave}>Save log</button></div>
    </header>
    <div className="diagnostics-meta"><span>{entries.length} events retained</span><span>MAX 200 · REDACTION ENABLED</span></div>
    <div className="diagnostics-stream">
      {recent.length === 0 ? <div className="diagnostics-empty"><b>No diagnostic events yet.</b><span>Start JARVIS, use voice, AI, tools or camera and events will appear here.</span></div> : recent.map(e => <article className={`diagnostic-row diagnostic-row--${e.status}`} key={e.id}>
        <time>{new Date(e.timestamp).toLocaleTimeString()}</time><i /><div className="diagnostic-main"><strong>{e.requestText || e.toolName || "JARVIS event"}</strong><span>{e.interpretedIntent ?? e.status}{e.providerName ? ` · ${e.providerName}` : ""}{e.toolName ? ` · ${e.toolName}` : ""}</span>{e.errorMessage && <em>{e.errorMessage}</em>}</div><small>{e.status}</small>
      </article>)}
    </div>
  </section>;
}
