import { useEffect, useRef } from "react";
import { JarvisVisualizer } from "./JarvisVisualizer";
import type { JarvisState } from "../../orchestrator/JarvisStateMachine";

interface Props {
  state: JarvisState;
  quality?: "low" | "medium" | "high";
  /** Real live AnalyserNode from an actual microphone stream (see App.tsx's
   * push-to-talk handlers), or null/undefined when no mic is active. Never
   * pass a synthesized AnalyserNode here — see JarvisVisualizer.setAudioLevel's
   * doc comment on why. */
  analyser?: AnalyserNode | null;
}

export function JarvisVisualizerView({ state, quality = "high", analyser }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<JarvisVisualizer | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const visualizer = new JarvisVisualizer(quality);
    visualizer.mount(container);
    visualizerRef.current = visualizer;
    return () => {
      visualizer.dispose();
      visualizerRef.current = null;
    };
  }, [quality]);

  useEffect(() => {
    visualizerRef.current?.setState(state);
  }, [state]);

  // Samples the real analyser at animation-frame rate and pushes the level
  // straight into the visualizer instance (imperative — bypasses React
  // state entirely) so mic-reactive motion never triggers a 60fps re-render
  // of the surrounding Home UI.
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!analyser) {
      visualizerRef.current?.setAudioLevel(0);
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const sample = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      visualizerRef.current?.setAudioLevel(Math.min(1, rms * 4));
      rafRef.current = requestAnimationFrame(sample);
    };
    rafRef.current = requestAnimationFrame(sample);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser]);

  return <div ref={containerRef} className="jarvis-visualizer" />;
}
