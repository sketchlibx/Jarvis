import { useEffect, useRef, useState } from "react";

interface Props {
  stream: MediaStream | null;
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
  onRecord: () => void;
}

export function ScreenShareOverlay({ stream, recording, onStart, onStop, onRecord }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!stream) return null;
  return (
    <aside className={`screen-share-overlay glass-panel ${collapsed ? "screen-share-overlay--collapsed" : ""}`}>
      <div className="screen-share-overlay__head">
        <span><i /> LIVE SCREEN</span>
        <div>
          <button onClick={() => setCollapsed(v => !v)} aria-label="Collapse screen share">{collapsed ? "□" : "—"}</button>
          <button onClick={onStop} aria-label="Stop screen sharing">×</button>
        </div>
      </div>
      {!collapsed && <>
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="screen-share-overlay__actions">
          <span>{recording ? "● Recording" : "Live preview"}</span>
          <button onClick={onRecord}>{recording ? "Stop & save" : "Record"}</button>
          <button onClick={onStart}>Reconnect</button>
        </div>
      </>}
    </aside>
  );
}
