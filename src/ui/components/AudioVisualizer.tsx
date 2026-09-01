import React, { useEffect, useRef, useState } from "react";

/**
 * Simple bar visualizer driven by an AnalyserNode. Renders flat/idle bars
 * when `active` is false rather than faking activity.
 */
export function AudioVisualizer({ analyser, active, barCount = 24 }: { analyser: AnalyserNode | null; active: boolean; barCount?: number }) {
  const [levels, setLevels] = useState<number[]>(new Array(barCount).fill(2));
  const rafRef = useRef<number>();

  useEffect(() => {
    if (!active || !analyser) {
      setLevels(new Array(barCount).fill(2));
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const step = Math.floor(data.length / barCount) || 1;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const next: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const v = data[i * step] ?? 0;
        next.push(Math.max(2, (v / 255) * 22));
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, analyser, barCount]);

  return (
    <div className="visualizer" aria-hidden="true">
      {levels.map((h, i) => (
        <div key={i} className="visualizer__bar" style={{ height: `${h}px` }} />
      ))}
    </div>
  );
}
