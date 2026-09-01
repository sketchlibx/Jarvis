import React, { useEffect, useRef } from "react";
import { JarvisVisualizer } from "./JarvisVisualizer";
import type { JarvisState } from "../../orchestrator/JarvisStateMachine";

interface Props {
  state: JarvisState;
  audioLevel?: number; // real amplitude only — see JarvisVisualizer.setAudioLevel's doc comment
}

export function JarvisVisualizerView({ state, audioLevel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<JarvisVisualizer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const visualizer = new JarvisVisualizer();
    visualizer.mount(container);
    visualizerRef.current = visualizer;
    return () => {
      visualizer.dispose();
      visualizerRef.current = null;
    };
  }, []);

  useEffect(() => {
    visualizerRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (audioLevel !== undefined) visualizerRef.current?.setAudioLevel(audioLevel);
  }, [audioLevel]);

  return <div ref={containerRef} className="jarvis-visualizer" />;
}
