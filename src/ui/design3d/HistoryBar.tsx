import { useState, useEffect } from 'react';
import React from "react";
import type { DesignController } from "../../design3d/commands/DesignController";
import type { ViewportHandle } from "./Viewport";

/** Minimal for Phase 4 — shows undo/redo depth plus real renderer stats
 * (draw calls / triangles) sourced from Three.js's own `renderer.info`,
 * never fabricated. A full scrubbable timeline (spec section 5's "bottom:
 * timeline/history/action area where useful") is a reasonable follow-up
 * once real usage patterns show what's actually useful to display there. */
export function HistoryBar({ controller, viewportRef }: { controller: DesignController; syncToken: number; viewportRef: React.RefObject<ViewportHandle> }) {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    if (viewportRef.current) {
      setInfo(viewportRef.current.getRendererInfo());
    }
  }, [viewportRef]);
  return (
    <div className="glass-panel studio-bottom" style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--text-muted)", display: "flex", gap: 16 }}>
      <span>{controller.graph.size} object{controller.graph.size === 1 ? "" : "s"}</span>
      <span>{controller.history.undoCount} undoable step{controller.history.undoCount === 1 ? "" : "s"}</span>
      <span>{controller.history.redoCount} redoable step{controller.history.redoCount === 1 ? "" : "s"}</span>
      {info && <span>{info.drawCalls} draw calls</span>}
      {info && <span>{info.triangles.toLocaleString()} triangles</span>}
    </div>
  );
}
