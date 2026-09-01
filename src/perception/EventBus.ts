import type { PerceptionEvent, PerceptionEventType } from "../types/perception";

type Listener<T = unknown> = (event: PerceptionEvent<T>) => void;

/**
 * Central perception event bus (spec section 14). Includes throttling and
 * duplicate suppression per spec section 31 ("do not send duplicate events
 * repeatedly", "throttle perception events") — both implemented here rather
 * than left as a TODO, since they're pure logic with no external deps.
 */
export class PerceptionEventBus {
  private listeners = new Map<PerceptionEventType, Set<Listener>>();
  private lastEmitted = new Map<string, { payloadKey: string; atMs: number }>();

  /** Minimum ms between identical (type + dedup key) events. */
  private readonly throttleMs: number;

  constructor(throttleMs = 150) {
    this.throttleMs = throttleMs;
  }

  on<T = unknown>(type: PerceptionEventType, listener: Listener<T>): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener as Listener);
    return () => this.listeners.get(type)?.delete(listener as Listener);
  }

  /**
   * Emits an event unless an identical one (same type + same dedup key,
   * typically source+payload signature) was emitted within `throttleMs`.
   * `dedupKey` defaults to a JSON stringification of the payload — callers
   * with high-frequency payloads (e.g. per-frame hand landmarks) should
   * pass a coarser key (e.g. rounded position) to avoid over-throttling
   * legitimately-changing data.
   */
  emit<T = unknown>(event: PerceptionEvent<T>, dedupKey?: string): void {
    const key = `${event.type}:${dedupKey ?? JSON.stringify(event.payload)}`;
    const now = Date.now();
    const last = this.lastEmitted.get(event.type);
    if (last && last.payloadKey === key && now - last.atMs < this.throttleMs) {
      return; // suppressed: duplicate within the throttle window
    }
    this.lastEmitted.set(event.type, { payloadKey: key, atMs: now });

    const handlers = this.listeners.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(event as PerceptionEvent<unknown>);
    }
  }

  clear(): void {
    this.listeners.clear();
    this.lastEmitted.clear();
  }
}
