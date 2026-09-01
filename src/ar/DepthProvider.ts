import type { DepthCapabilities, DepthProvider } from "./types";

/** The only depth signal actually available in this codebase: MediaPipe's
 * relative landmark z. Explicitly NOT metric — `getCapabilities().metric`
 * is `false`, and callers must check that before treating the number as
 * anything beyond "nearer/farther, unitless." */
export class MonocularDepthProvider implements DepthProvider {
  private latestZByPoint = new Map<string, number>();

  isAvailable(): boolean {
    return true;
  }

  getCapabilities(): DepthCapabilities {
    return { metric: false, relative: true };
  }

  getDepth(normalizedX: number, normalizedY: number): number | null {
    const key = this.keyFor(normalizedX, normalizedY);
    return this.latestZByPoint.get(key) ?? null;
  }

  record(normalizedX: number, normalizedY: number, z: number): void {
    this.latestZByPoint.set(this.keyFor(normalizedX, normalizedY), z);
  }

  private keyFor(x: number, y: number): string {
    return `${Math.round(x * 20)}:${Math.round(y * 20)}`;
  }
}

/** Used when no depth signal is available at all — never silently returns
 * 0 or a fabricated number. */
export class NoDepthProvider implements DepthProvider {
  isAvailable(): boolean { return false; }
  getCapabilities(): DepthCapabilities { return { metric: false, relative: false }; }
  getDepth(_normalizedX: number, _normalizedY: number): number | null { return null; }
}
