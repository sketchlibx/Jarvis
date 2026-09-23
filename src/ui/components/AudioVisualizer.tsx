import { useEffect, useRef } from "react";

/**
 * Real microphone spectrum visualizer. Animation is kept outside React state
 * so a 120 Hz display does not cause 120 component re-renders per second.
 */
export function AudioVisualizer({ analyser, active, barCount = 24 }: { analyser: AnalyserNode | null; active: boolean; barCount?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const container = containerRef.current;
    if (!container) return;
    const bars = Array.from(container.children) as HTMLElement[];

    if (!active || !analyser) {
      bars.forEach((bar) => {
        bar.style.transform = "scaleY(0.09)";
      });
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.max(1, Math.floor(data.length / barCount));
    let previous = new Float32Array(barCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < barCount; i++) {
        const v = data[Math.min(data.length - 1, i * step)] ?? 0;
        const target = Math.max(0.09, v / 255);
        // Lightweight smoothing keeps the wave fluid without a React render.
        previous[i] += (target - previous[i]) * 0.28;
        bars[i]?.style.setProperty("transform", `scaleY(${0.09 + previous[i] * 0.91})`);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, analyser, barCount]);

  return (
    <div ref={containerRef} className="visualizer" aria-hidden="true">
      {Array.from({ length: barCount }, (_, i) => (
        <div key={i} className="visualizer__bar" />
      ))}
    </div>
  );
}
