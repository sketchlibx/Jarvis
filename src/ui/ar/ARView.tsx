import React, { useEffect, useRef, useState } from "react";
import { ARController } from "../../ar/ARController";
import { ARControlBar } from "./ARControlBar";
import { ARDebugOverlay } from "./ARDebugOverlay";
import type { DesignController } from "../../design3d/commands/DesignController";
import type { VisionPipeline } from "../../vision/VisionPipeline";
import type { VisionPipelineStats } from "../../types/perception";

interface Props {
  designController: DesignController;
  /** Reused, not duplicated — the SAME VisionPipeline instance the main
   * Assistant view's camera panel already drives (spec section 1: "do not
   * create duplicate camera/MediaPipe systems"). ARView only subscribes to
   * its snapshot/stats streams; it never calls start()/stop() on the
   * camera itself — that remains the main view's responsibility, so AR
   * mode never creates a second capture pipeline. */
  visionPipeline: VisionPipeline;
  cameraStream: MediaStream | null;
  selectedDesignObjectId: string | null;
  onExit: () => void;
}

/**
 * # Status: UNVERIFIED (no browser/WebGL/camera available in this sandbox).
 *
 * Composes the real camera `<video>` (spec section 6: stays visible
 * underneath) with `ARScene`'s transparent canvas on top, both inside one
 * positioned container so they share exact pixel alignment. Written
 * carefully against real browser APIs, not run.
 */
export function ARView({ designController, visionPipeline, cameraStream, selectedDesignObjectId, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ARController | null>(null);

  const [arEnabled, setArEnabled] = useState(true);
  const arEnabledRef = useRef(arEnabled);
  useEffect(() => { arEnabledRef.current = arEnabled; }, [arEnabled]);
  const [debugMode, setDebugMode] = useState(false);
  const [visionStats, setVisionStats] = useState<VisionPipelineStats | null>(null);
  const [, setStatsTick] = useState(0);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    const container = overlayContainerRef.current;
    if (!container) return;

    const viewport = { width: container.clientWidth, height: container.clientHeight, verticalFovDegrees: 50, projectionDistance: 1 };
    const controller = new ARController(designController, viewport);
    controller.scene.mount(container);
    controllerRef.current = controller;

    const resizeObserver = new ResizeObserver(() => {
      controller.updateViewport({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);

    // Subscribe to the EXISTING VisionPipeline's snapshot stream — this is
    // the reuse point spec section 1 requires. ARView never calls
    // visionPipeline.start()/attachStream() itself.
    const unsubSnapshot = visionPipeline.onSnapshot((snapshot) => {
      if (!arEnabledRef.current) return; // AR OFF: stop updating anchors/transforms entirely, not just hide the canvas
      const nowMs = Date.now();
      controller.update(nowMs, snapshot.hands, snapshot.face, snapshot.pose);
      setStatsTick((t) => t + 1);
    });
    const unsubStats = visionPipeline.onStats(setVisionStats);

    return () => {
      resizeObserver.disconnect();
      unsubSnapshot();
      unsubStats();
      // Full teardown per spec section 38 — but the underlying
      // VisionPipeline/camera keep running if the main view still needs
      // them; ARView only tears down what IT owns (the transparent scene).
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.setSelectedInstance(selectedInstanceIdFor(selectedDesignObjectId, controllerRef.current));
  }, [selectedDesignObjectId]);

  const stats = controllerRef.current?.getStats() ?? { trackingState: "UNAVAILABLE" as const, handsDetected: 0, activeInstances: 0, selectedInstanceId: null };

  return (
    <div className="ar-view studio-viewport">
      <video ref={videoRef} autoPlay playsInline muted />
      <div ref={overlayContainerRef} style={{ position: "absolute", inset: 0 }} />
      <ARControlBar
        arEnabled={arEnabled}
        onToggleAR={() => setArEnabled((e) => !e)}
        selectedObjectName={selectedDesignObjectId}
        trackingState={stats.trackingState}
        currentGesture={null}
        onOpenCalibration={() => { /* opens a calibration panel — see README for current scope */ }}
        debugMode={debugMode}
        onToggleDebug={() => setDebugMode((d) => !d)}
      />
      {debugMode && (
        <ARDebugOverlay stats={stats} visionStats={visionStats} coordinateMappingReady={!!overlayContainerRef.current} />
      )}
      <button
        onClick={onExit}
        style={{ position: "absolute", bottom: 12, right: 12, zIndex: 5, background: "rgba(0,0,0,0.5)", border: "1px solid var(--border-glass)", borderRadius: 6, color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
      >
        Exit AR
      </button>
    </div>
  );
}

/** Maps a selected DesignGraph object id to whatever AR instance
 * currently references it, if any — the deterministic selection strategy
 * spec section 21 asks for (no gesture-guessed selection). */
function selectedInstanceIdFor(designObjectId: string | null, controller: ARController | null): string | null {
  if (!designObjectId || !controller) return null;
  const match = controller.instanceManager.all().find((i) => i.designObjectId === designObjectId);
  return match?.id ?? null;
}
