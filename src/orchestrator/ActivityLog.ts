// ---------------------------------------------------------------------
// Command center activity log — spec section 11. Displays current
// request/intent/provider/tool/status without ever exposing a secret.
// ---------------------------------------------------------------------

export type ActivityStatus = "understanding" | "routing" | "executing" | "waiting_confirmation" | "completed" | "error";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  requestText: string;
  interpretedIntent: string | null;
  providerName: string | null;
  toolName: string | null;
  status: ActivityStatus;
  /** Redacted BEFORE storage — see `redactActivityParams` below. Never
   * assign raw params directly to this field. */
  redactedParams: string | null;
  errorMessage: string | null;
}

/**
 * Mirrors the EXACT key list Rust's `redact_params` (commands.rs) uses, so
 * a value considered sensitive on one side of the security boundary is
 * treated identically on the other. There's no way to literally share a
 * Rust const with TypeScript across the Tauri IPC boundary, so this
 * comment is the enforcement mechanism: if you touch one list, touch both.
 */
const SENSITIVE_PARAM_KEYS = [
  "api_key", "apikey", "password", "token", "secret", "auth", "authorization",
  "credential", "credentials", "clipboard_content",
];

export function redactActivityParams(params: unknown): string {
  function walk(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const keyLower = k.toLowerCase();
        out[k] = SENSITIVE_PARAM_KEYS.some((s) => keyLower.includes(s)) ? "[REDACTED]" : walk(val);
      }
      return out;
    }
    return v;
  }
  try {
    return JSON.stringify(walk(params));
  } catch {
    return "[unserializable params]";
  }
}

const MAX_ENTRIES = 200;

export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private listeners = new Set<(entries: ActivityEntry[]) => void>();
  private counter = 0;

  record(entry: Omit<ActivityEntry, "id" | "timestamp" | "redactedParams"> & { rawParams?: unknown }): ActivityEntry {
    this.counter += 1;
    const { rawParams, ...rest } = entry;
    const full: ActivityEntry = {
      ...rest,
      id: `activity_${this.counter}`,
      timestamp: new Date().toISOString(),
      redactedParams: rawParams !== undefined ? redactActivityParams(rawParams) : null,
    };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.notify();
    return full;
  }

  updateStatus(id: string, status: ActivityStatus, errorMessage?: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = status;
    if (errorMessage !== undefined) entry.errorMessage = errorMessage;
    this.notify();
  }

  getEntries(): ActivityEntry[] {
    return [...this.entries];
  }

  getLatest(): ActivityEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  onChange(cb: (entries: ActivityEntry[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getEntries();
    this.listeners.forEach((cb) => cb(snapshot));
  }
}
