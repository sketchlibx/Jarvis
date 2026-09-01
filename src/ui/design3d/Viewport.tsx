import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { SceneManager } from "../../design3d/engine/SceneManager";
import { GraphRenderer } from "../../design3d/engine/GraphRenderer";
import type { DesignController } from "../../design3d/commands/DesignController";

interface Props {
  controller: DesignController;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wireframe: boolean;
  /** Bumped by the parent whenever the graph changes, so the viewport
   * re-syncs meshes without needing the graph itself to be reactive
   * state (DesignGraph is a plain class, not observed by React). */
  syncToken: number;
}

export interface ViewportHandle {
  resetCamera: () => void;
  getRendererInfo: () => { drawCalls: number; triangles: number } | null;
}

/**
 * # Status: UNVERIFIED — real Three.js mount/dispose lifecycle, not run
 * against a browser in this sandbox. The mount/unmount pairing below is
 * the part spec section 4 cares most about (no leaked WebGL contexts) —
 * written carefully, not confirmed.
 */
export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(
  { controller, selectedId, onSelect, wireframe, syncToken }, ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);

  useImperativeHandle(ref, () => ({
    resetCamera: () => sceneManagerRef.current?.resetCamera(),
    getRendererInfo: () => sceneManagerRef.current?.getRendererInfo() ?? null,
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sceneManager = new SceneManager();
    const graphRenderer = new GraphRenderer(sceneManager);
    sceneManager.mount(container);
    graphRenderer.syncFromGraph(controller.graph);
    sceneManagerRef.current = sceneManager;
    rendererRef.current = graphRenderer;

    const handleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const hitId = graphRenderer.raycastSelect(sceneManager.camera, ndcX, ndcY);
      onSelect(hitId);
    };
    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
      // Full teardown per spec section 4 — renderer, controls, meshes,
      // geometries, materials, textures, and the resize observer all go
      // away here. This is the single most important cleanup path in the
      // whole 3D subsystem.
      graphRenderer.dispose();
      sceneManager.dispose();
      sceneManagerRef.current = null;
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; controller identity is stable for the studio's lifetime

  useEffect(() => {
    rendererRef.current?.syncFromGraph(controller.graph);
  }, [syncToken, controller]);

  useEffect(() => {
    rendererRef.current?.select(selectedId);
  }, [selectedId]);

  useEffect(() => {
    sceneManagerRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  return <div ref={containerRef} className="studio-viewport glass-panel" />;
});
