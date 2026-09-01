import React, { useEffect, useRef } from "react";
import type { CameraStatus } from "../../types/vision";
import type { FaceObservation, HandObservation, PoseObservation } from "../../types/perception";

interface Props {
  status: CameraStatus;
  stream: MediaStream | null;
  hands: HandObservation[];
  face?: FaceObservation | null;
  pose?: PoseObservation | null;
  /** Real numbers from VisionPipeline's own frame/detector counters —
   * never derived from React's render rate (spec section 16 explicitly
   * forbids that). Undefined until the pipeline reports its first stats
   * tick, in which case we simply don't show an FPS figure yet rather
   * than showing a fake 0 or placeholder. */
  cameraFps?: number;
  visionFps?: number;
  onStart: () => void;
  onStop: () => void;
}

const STATUS_LABEL: Record<CameraStatus, string> = {
  unavailable: "Camera unavailable",
  permission_denied: "Camera permission denied",
  off: "Camera off",
  starting: "Starting…",
  on: "Live",
  error: "Camera error",
};

// MediaPipe Hands connections (pairs of landmark indices) for drawing the
// skeleton, not just dots — standard MediaPipe hand topology.
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [5, 9], [9, 10], [10, 11], [11, 12],  // middle
  [9, 13], [13, 14], [14, 15], [15, 16],// ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17],
];

/**
 * Displays the live camera feed plus a real landmark overlay drawn from
 * REAL detection results passed in via `hands`/`face`/`pose` — never
 * synthetic/demo landmarks. When those are empty (no detector active, or
 * nothing detected this frame), the overlay simply draws nothing rather
 * than a placeholder.
 *
 * The overlay canvas and video share the same CSS transform (mirrored via
 * `.camera-panel__overlay-canvas` in global.css using the same
 * `scaleX(-1)` as `.camera-panel video`), so landmark coordinates are
 * drawn in their original, un-mirrored normalized space — the mirroring is
 * a pure CSS presentation transform applied identically to both layers,
 * not a coordinate transform we compute ourselves (spec section 15's
 * explicit warning against altering underlying coordinates for display reasons).
 */
export function CameraPanel({ status, stream, hands, face, pose, cameraFps, visionFps, onStart, onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const hand of hands) {
      ctx.strokeStyle = "rgba(78, 225, 255, 0.5)";
      ctx.lineWidth = 2;
      for (const [a, b] of HAND_CONNECTIONS) {
        const la = hand.landmarks[a];
        const lb = hand.landmarks[b];
        if (!la || !lb) continue;
        ctx.beginPath();
        ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
        ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(78, 225, 255, 0.9)";
      for (const lm of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (face?.detected) {
      ctx.fillStyle = "rgba(255, 184, 77, 0.7)";
      // Sparse sample rather than all 468 points — a dense dot cloud reads
      // as noise at this resolution; every 7th point still traces the mesh
      // shape clearly.
      for (let i = 0; i < face.landmarks.length; i += 7) {
        const lm = face.landmarks[i];
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (pose?.detected) {
      ctx.fillStyle = "rgba(78, 225, 160, 0.9)";
      ctx.strokeStyle = "rgba(78, 225, 160, 0.5)";
      ctx.lineWidth = 2;
      const pts = pose.landmarks;
      const skeleton: Array<[typeof pts.leftShoulder, typeof pts.rightShoulder]> = [
        [pts.leftShoulder, pts.rightShoulder],
        [pts.leftShoulder, pts.leftElbow], [pts.leftElbow, pts.leftWrist],
        [pts.rightShoulder, pts.rightElbow], [pts.rightElbow, pts.rightWrist],
      ];
      for (const [a, b] of skeleton) {
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
        ctx.stroke();
      }
      for (const p of Object.values(pts)) {
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [hands, face, pose]);

  if (status !== "on" && status !== "starting") {
    return (
      <div className="glass-panel camera-panel">
        <div className="camera-panel__off">
          <span>{STATUS_LABEL[status]}</span>
          {(status === "off" || status === "error") && (
            <button className="camera-btn" onClick={onStart}>Start Camera</button>
          )}
        </div>
      </div>
    );
  }

  const fpsLabel = cameraFps !== undefined && visionFps !== undefined ? ` · ${cameraFps} fps cam / ${visionFps} fps vision` : "";

  return (
    <div className="glass-panel camera-panel">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={canvasRef} className="camera-panel__overlay-canvas" />
      <div className="camera-panel__badge">
        <span className="status-dot__indicator" style={{ background: "var(--safe)", boxShadow: "0 0 6px var(--safe)" }} />
        {STATUS_LABEL[status]} {hands.length > 0 && `· ${hands.length} hand(s)`}
        {face?.detected && " · face"} {pose?.detected && " · pose"}
        {fpsLabel}
      </div>
      <div className="camera-panel__controls">
        <button className="camera-btn camera-btn--stop" onClick={onStop}>Stop Camera</button>
      </div>
    </div>
  );
}
