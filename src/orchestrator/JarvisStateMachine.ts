export type JarvisState =
  | "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "EXECUTING" | "WAITING_CONFIRMATION" | "ERROR" | "OFFLINE";

export interface JarvisStateEvent {
  state: JarvisState;
  timestamp: string;
  /** Free-text context for the command center display (spec section 11)
   * — e.g. "Provider: Gemini", "Tool: browser.search". Never contains a
   * secret; see ActivityLog's redaction note. */
  detail?: string;
}

const VALID_TRANSITIONS: Record<JarvisState, JarvisState[]> = {
  IDLE: ["LISTENING", "THINKING", "OFFLINE", "ERROR"],
  LISTENING: ["THINKING", "IDLE", "ERROR", "OFFLINE"],
  THINKING: ["SPEAKING", "EXECUTING", "WAITING_CONFIRMATION", "IDLE", "ERROR", "OFFLINE"],
  SPEAKING: ["IDLE", "LISTENING", "ERROR", "OFFLINE"],
  EXECUTING: ["SPEAKING", "IDLE", "WAITING_CONFIRMATION", "ERROR", "OFFLINE"],
  WAITING_CONFIRMATION: ["EXECUTING", "IDLE", "ERROR", "OFFLINE"],
  ERROR: ["IDLE", "OFFLINE"],
  OFFLINE: ["IDLE"],
};

/**
 * Single source of truth for JARVIS's current high-level state, driving
 * both the 3D visualizer (spec section 9) and the command-center display
 * (spec section 11). Transitions are explicitly validated — an invalid
 * transition (e.g. SPEAKING -> WAITING_CONFIRMATION, which skips THINKING/
 * EXECUTING) is rejected rather than silently accepted, so a bug elsewhere
 * can't put the visualizer in a nonsensical state.
 */
export class JarvisStateMachine {
  private current: JarvisState = "IDLE";
  private history: JarvisStateEvent[] = [];
  private listeners = new Set<(event: JarvisStateEvent) => void>();
  private readonly maxHistory: number;

  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
  }

  get state(): JarvisState {
    return this.current;
  }

  canTransition(to: JarvisState): boolean {
    return VALID_TRANSITIONS[this.current].includes(to);
  }

  /** Returns false (and does NOT change state) for an invalid transition,
   * rather than throwing — callers in a UI event-handling context
   * generally want to check-and-ignore, not crash. */
  transition(to: JarvisState, detail?: string): boolean {
    if (!this.canTransition(to)) return false;
    this.current = to;
    const event: JarvisStateEvent = { state: to, timestamp: new Date().toISOString(), detail };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.listeners.forEach((cb) => cb(event));
    return true;
  }

  /** OFFLINE and ERROR are reachable from any state — a connectivity loss
   * or an unexpected failure shouldn't be blocked by the normal transition
   * graph, which is why they're handled here as an escape hatch rather
   * than added to every state's transition list individually. */
  forceState(to: "OFFLINE" | "ERROR", detail?: string): void {
    this.current = to;
    const event: JarvisStateEvent = { state: to, timestamp: new Date().toISOString(), detail };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.listeners.forEach((cb) => cb(event));
  }

  onTransition(cb: (event: JarvisStateEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getHistory(): JarvisStateEvent[] {
    return [...this.history];
  }

  reset(): void {
    this.current = "IDLE";
    this.history = [];
  }
}
