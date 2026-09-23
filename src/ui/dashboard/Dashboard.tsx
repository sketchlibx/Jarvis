import { useState } from "react";
import type { CSSProperties } from "react";
import type { JarvisState } from "../../orchestrator/JarvisStateMachine";
import type { ActivityEntry } from "../../orchestrator/ActivityLog";
import type { HandObservation, FaceObservation, PoseObservation, StateEstimate, GestureLabel } from "../../types/perception";
import type { RemoteBridgeInfo } from "../../device/RemoteControlBridge";

interface Props {
  onExit: () => void;
  onOpenDesignStudio: () => void;
  onOpenSettings: () => void;
  cameraStatus: "unavailable" | "permission_denied" | "off" | "starting" | "on" | "error";
  onStartCamera: () => void;
  hands: HandObservation[];
  faceObservation: FaceObservation | null;
  poseObservation: PoseObservation | null;
  gesture: GestureLabel | null;
  jarvisState: JarvisState;
  stateEstimate: StateEstimate | null;
  activityEntries: ActivityEntry[];
  isOnline: boolean;
  aiAvailable: boolean;
  activeProviderName: string | null;
  remoteBridge: RemoteBridgeInfo | null;
  onStartRemoteControl: () => Promise<RemoteBridgeInfo>;
  onStopRemoteControl: () => Promise<void>;
  onRotateRemoteToken: () => Promise<RemoteBridgeInfo>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    brain: "M9.5 4.5a3 3 0 0 0-5.7 1.3A3.2 3.2 0 0 0 4 12a3 3 0 0 0 1.5 5.5h.5a3 3 0 0 0 5.5 1.2 3 3 0 0 0 5.5-1.2h.5A3 3 0 0 0 19 12a3.2 3.2 0 0 0 .2-6.2A3 3 0 0 0 13.5 4a3 3 0 0 0-4 0Z",
    phone: "M7 2.8h10A1.8 1.8 0 0 1 18.8 4.6v14.8a1.8 1.8 0 0 1-1.8 1.8H7a1.8 1.8 0 0 1-1.8-1.8V4.6A1.8 1.8 0 0 1 7 2.8Zm3 16h4",
    spark: "m12 2 1.4 5.6L19 9l-5.6 1.4L12 16l-1.4-5.6L5 9l5.6-1.4L12 2Zm6.5 13 .6 2.4L21.5 18l-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6.6-2.4Z",
    cube: "m12 2.8 8 4.5v9.4l-8 4.5-8-4.5V7.3l8-4.5Zm0 0v9m8-4.5-8 4.5-8-4.5",
    shield: "M12 2.7 20 6v5.4c0 5.1-3.3 8.6-8 10-4.7-1.4-8-4.9-8-10V6l8-3.3Z",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] ?? paths.spark} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function QrCode({ value }: { value: string }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(value)}`;
  return <img className="jarvis-qr" src={src} alt="JARVIS phone pairing QR code" loading="eager" />;
}

export function Dashboard({
  onExit, onOpenDesignStudio, onOpenSettings,
  cameraStatus, onStartCamera, hands, faceObservation, poseObservation, gesture,
  jarvisState, stateEstimate, activityEntries, isOnline, aiAvailable, activeProviderName, remoteBridge, onStartRemoteControl, onStopRemoteControl, onRotateRemoteToken,
}: Props) {
  const [showPairing, setShowPairing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [rotateBusy, setRotateBusy] = useState(false);
  const pairUrl = remoteBridge?.pair_url ?? "";
  const recentActivity = activityEntries.slice(-7).reverse();
  const confidence = stateEstimate ? Math.round(stateEstimate.confidence * 100) : 0;
  const expiresAt = remoteBridge?.expires_at ? new Date(remoteBridge.expires_at) : null;
  const expiresInMinutes = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60000)) : null;
  const failedAttempts = remoteBridge?.failed_attempts_recent ?? 0;

  const copyPairLink = async () => {
    if (!pairUrl) return;
    try {
      await navigator.clipboard.writeText(pairUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard can be unavailable in insecure contexts */ }
  };

  const startPairing = async () => {
    setPairingBusy(true);
    setPairingError(null);
    try {
      await onStartRemoteControl();
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error));
    } finally {
      setPairingBusy(false);
    }
  };

  const stopPairing = async () => {
    setPairingBusy(true);
    setPairingError(null);
    try {
      await onStopRemoteControl();
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error));
    } finally {
      setPairingBusy(false);
    }
  };

  const rotateToken = async () => {
    setRotateBusy(true);
    setPairingError(null);
    try {
      await onRotateRemoteToken();
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error));
    } finally {
      setRotateBusy(false);
    }
  };

  return (
    <div className="jarvis-dashboard">
      <div className="dashboard-ambient dashboard-ambient--one" />
      <div className="dashboard-ambient dashboard-ambient--two" />

      <header className="dashboard-topbar">
        <button className="dashboard-brand" onClick={onExit} title="Return to JARVIS core">
          <span className="dashboard-brand__orb"><Icon name="brain" /></span>
          <span><b>JARVIS</b><small>NEURAL COMMAND CENTER</small></span>
        </button>
        <div className="dashboard-topbar__status">
          <span className={`live-dot ${isOnline ? "live-dot--on" : ""}`} />
          {isOnline ? "ONLINE" : "OFFLINE"}
          <span className="dashboard-clock">{remoteBridge?.enabled ? `REMOTE ${remoteBridge.token.slice(0, 8).toUpperCase()}` : "REMOTE OFF"}</span>
        </div>
        <div className="dashboard-topbar__actions">
          <button onClick={() => setShowPairing(true)}><Icon name="phone" /> {remoteBridge?.enabled ? "PAIRED" : "CONNECT"}</button>
          <button onClick={onOpenSettings}>SETTINGS</button>
        </div>
      </header>

      <main className="dashboard-content">
        <section className="dashboard-hero hud-frame">
          <div className="dashboard-hero__copy">
            <span className="eyebrow">COGNITIVE OPERATING SYSTEM</span>
            <h1>Your command center,<br /><em>fully aware.</em></h1>
            <p>Voice, vision, memory, AI providers and creative tools unified into one live JARVIS core.</p>
            <div className="dashboard-hero__actions">
              <button className="primary-action" onClick={onExit}><Icon name="spark" /> Open Core</button>
              <button className="secondary-action" onClick={onOpenDesignStudio}><Icon name="cube" /> 3D Studio</button>
            </div>
          </div>
          <div className="dashboard-core-ring">
            <div className="core-ring__orbit core-ring__orbit--a" />
            <div className="core-ring__orbit core-ring__orbit--b" />
            <div className="core-ring__center"><Icon name="brain" /><strong>{jarvisState}</strong><span>{activeProviderName ?? "NO PROVIDER"}</span></div>
          </div>
        </section>

        <section className="metric-row">
          <article className="metric-card"><span>CORE STATE</span><strong>{jarvisState}</strong><small>Live state machine</small></article>
          <article className="metric-card"><span>AI PROVIDER</span><strong>{activeProviderName ?? "UNCONFIGURED"}</strong><small>{aiAvailable ? "Ready for requests" : "Needs configuration"}</small></article>
          <article className="metric-card"><span>VISION</span><strong>{cameraStatus === "on" ? "ACTIVE" : "STANDBY"}</strong><small>{hands.length} hands · {poseObservation?.detected ? "pose" : "no pose"}</small></article>
          <article className="metric-card"><span>NETWORK</span><strong>{isOnline ? "CONNECTED" : "OFFLINE"}</strong><small>Browser connectivity</small></article>
        </section>

        <div className="dashboard-grid dashboard-grid--pro">
          <section className="dashboard-card dashboard-card--wide hud-frame">
            <div className="card-heading"><div><span className="card-kicker">NEURAL TELEMETRY</span><h2>Cognitive state</h2></div><span className="status-chip">LIVE</span></div>
            <div className="telemetry-body">
              <div className="confidence-ring" style={{ "--progress": `${confidence * 3.6}deg` } as CSSProperties}><b>{confidence}%</b><span>confidence</span></div>
              <div className="telemetry-facts">
                <div><span>Fused state</span><b>{stateEstimate?.state ?? "Waiting for signals"}</b></div>
                <div><span>Signal sources</span><b>{stateEstimate?.signals.length ?? 0}</b></div>
                <div><span>Face</span><b>{faceObservation?.detected ? `${Math.round(faceObservation.confidence * 100)}% detected` : "Not detected"}</b></div>
                <div><span>Gesture</span><b>{gesture ?? "None"}</b></div>
              </div>
            </div>
          </section>

          <section className="dashboard-card hud-frame">
            <div className="card-heading"><div><span className="card-kicker">PERCEPTION</span><h2>Vision stack</h2></div><span className="module-icon"><Icon name="spark" /></span></div>
            <div className="stack-list">
              <div><span>Camera</span><b className={cameraStatus === "on" ? "good" : "muted"}>{cameraStatus.toUpperCase()}</b></div>
              <div><span>Hands</span><b>{hands.length}</b></div>
              <div><span>Face model</span><b>{faceObservation?.detected ? "TRACKING" : "READY"}</b></div>
              <div><span>Pose model</span><b>{poseObservation?.detected ? "TRACKING" : "READY"}</b></div>
            </div>
            {cameraStatus !== "on" && <button className="card-button" onClick={onStartCamera}>Initialize camera</button>}
          </section>

          <section className="dashboard-card hud-frame">
            <div className="card-heading"><div><span className="card-kicker">SECURITY</span><h2>Guard rails</h2></div><span className="module-icon"><Icon name="shield" /></span></div>
            <div className="security-score"><div><strong>LOCAL</strong><span>keys + memory controls</span></div><i>●</i></div>
            <p className="card-note">Sensitive actions remain confirmation-gated. Provider keys stay outside normal settings data.</p>
            <button className="card-button" onClick={onOpenSettings}>Review security</button>
          </section>

          <section className="dashboard-card dashboard-card--wide hud-frame">
            <div className="card-heading"><div><span className="card-kicker">ACTIVITY STREAM</span><h2>What JARVIS is doing</h2></div><span className="status-chip status-chip--dim">{recentActivity.length} EVENTS</span></div>
            {recentActivity.length === 0 ? <div className="empty-stream">No activity yet. Use the core to start a task.</div> : <div className="activity-stream">{recentActivity.map((entry) => <div className="activity-item" key={entry.id}><span className={`activity-dot activity-dot--${entry.status}`} /><div><b>{entry.requestText}</b><small>{entry.interpretedIntent ?? "command"}</small></div><em>{entry.status.replace(/_/g, " ")}</em></div>)}</div>}
          </section>
        </div>

        <section className="quick-actions">
          <button onClick={() => setShowPairing(true)}><Icon name="phone" /><span>Pair phone</span><small>{remoteBridge?.enabled ? `LAN ${remoteBridge.host}:${remoteBridge.port}` : "Secure local bridge"}</small></button>
          <button onClick={onOpenDesignStudio}><Icon name="cube" /><span>Open 3D studio</span><small>Design workspace</small></button>
          <button onClick={onOpenSettings}><Icon name="shield" /><span>AI & security</span><small>Providers + permissions</small></button>
          <button onClick={onExit}><Icon name="spark" /><span>Talk to JARVIS</span><small>Voice + chat core</small></button>
        </section>
      </main>

      {showPairing && <div className="pairing-overlay" role="dialog" aria-modal="true">
        <div className="pairing-modal hud-frame">
          <button className="pairing-close" onClick={() => setShowPairing(false)}>×</button>
          <div className="pairing-copy"><span className="eyebrow">SECURE DEVICE PAIRING</span><h2>Connect a phone to JARVIS</h2><p>The desktop bridge now exposes a short-lived authenticated LAN endpoint for the future companion app. It is OFF until you explicitly start it.</p></div>
          {!remoteBridge?.enabled ? (
            <div className="pairing-start-state">
              <div className="module-icon"><Icon name="shield" /></div>
              <strong>Remote control is off</strong>
              <span>No network listener is running.</span>
              <button className="primary-action" disabled={pairingBusy} onClick={startPairing}>{pairingBusy ? "STARTING…" : "START SECURE BRIDGE"}</button>
              {pairingError && <small className="pairing-error">{pairingError}</small>}
            </div>
          ) : (
            <>
              <div className="pairing-qr-wrap"><QrCode value={pairUrl} /><span>LAN {remoteBridge.host}:{remoteBridge.port}</span></div>
              <div className="pairing-link"><input readOnly value={pairUrl} /><button onClick={copyPairLink}>{copied ? "COPIED" : "COPY"}</button></div>
              <div className="pairing-security-state">
                <span className={`status-chip ${failedAttempts > 0 ? "status-chip--warn" : "status-chip--dim"}`}>
                  {failedAttempts > 0 ? `${failedAttempts} FAILED ATTEMPT${failedAttempts === 1 ? "" : "S"}` : "NO FAILED ATTEMPTS"}
                </span>
                <span className="status-chip status-chip--dim">
                  {expiresInMinutes !== null ? `TOKEN EXPIRES IN ${expiresInMinutes}m` : "TOKEN EXPIRY UNKNOWN"}
                </span>
              </div>
              <div className="pairing-actions">
                <button className="secondary-action" onClick={rotateToken} disabled={rotateBusy || pairingBusy}>{rotateBusy ? "ROTATING…" : "ROTATE TOKEN"}</button>
                <button className="secondary-action" onClick={stopPairing} disabled={pairingBusy}>{pairingBusy ? "STOPPING…" : "STOP BRIDGE"}</button>
              </div>
              {pairingError && <small className="pairing-error">{pairingError}</small>}
              <small className="pairing-note">The companion app can use the tokenized pairing URL, then send authenticated commands (via an Authorization header) to this PC. Only the existing JARVIS view/listening/screen-capture command surface is exposed; destructive OS tools are not exposed by the remote bridge. Repeated wrong tokens from the same address are rate-limited and locked out; every attempt is written to the audit log; rotating invalidates the token above immediately.</small>
            </>
          )}
        </div>
      </div>}
    </div>
  );
}
