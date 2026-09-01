// ---------------------------------------------------------------------
// Multi-agent provider architecture — Phase 6 sections 3-5. Extends the
// existing AIProvider abstraction (src/types/ai.ts, src/ai/AIProvider.ts)
// rather than replacing it — every provider here still implements the
// same AIProvider interface from Phase 1; this file only adds the
// metadata layer (capabilities, config, status) needed to route between
// several of them intelligently.
// ---------------------------------------------------------------------

export type ProviderCapability =
  | "TEXT" | "VISION" | "WEB" | "TOOL_CALLING" | "LONG_CONTEXT" | "STRUCTURED_OUTPUT" | "STREAMING";

export const ALL_CAPABILITIES: ProviderCapability[] = [
  "TEXT", "VISION", "WEB", "TOOL_CALLING", "LONG_CONTEXT", "STRUCTURED_OUTPUT", "STREAMING",
];

export type ProviderAvailability = "unknown" | "available" | "unavailable" | "rate_limited" | "invalid_key" | "disabled";

export interface ProviderStatus {
  availability: ProviderAvailability;
  lastError: string | null;
  lastCheckedAt: string | null;
  /** Consecutive failure count — used by the router to temporarily
   * deprioritize a flaky provider without permanently disabling it
   * (spec section 4: "previous provider failure" as a routing input). */
  consecutiveFailures: number;
}

export function initialProviderStatus(): ProviderStatus {
  return { availability: "unknown", lastError: null, lastCheckedAt: null, consecutiveFailures: 0 };
}

export interface ProviderConfig {
  /** Matches AIProvider.providerName — the join key between the simple
   * registry (Phase 1) and this metadata layer. */
  name: string;
  displayName: string;
  enabled: boolean;
  /** Never the raw key itself — see SECURITY.md "API key storage status."
   * This only records WHETHER a key has been configured, so the UI can
   * show a status dot without ever holding the secret in this object. */
  hasApiKey: boolean;
  model: string;
  /** Lower number = tried first. Ties broken by registration order. */
  priority: number;
  capabilities: ProviderCapability[];
}

export type TaskType = "chat" | "vision" | "web_search" | "tool_use" | "structured_output" | "long_context_summary";

/** Maps a task type to the capability it requires — the router will never
 * send a task to a provider lacking the matching capability (spec section 5). */
export const TASK_REQUIRED_CAPABILITY: Record<TaskType, ProviderCapability> = {
  chat: "TEXT",
  vision: "VISION",
  web_search: "WEB",
  tool_use: "TOOL_CALLING",
  structured_output: "STRUCTURED_OUTPUT",
  long_context_summary: "LONG_CONTEXT",
};

export interface RoutingRequest {
  task: TaskType;
  /** If set, the router MUST use exactly this provider or fail — never
   * silently substitute another one (spec section 4's explicit rule). */
  forceProvider?: string;
}

export type RoutingFailureReason =
  | "no_providers_registered"
  | "forced_provider_not_found"
  | "forced_provider_unavailable"
  | "no_provider_supports_capability"
  | "all_candidates_disabled_or_unconfigured"
  | "all_candidates_failed";

export type RoutingResult =
  | { success: true; providerName: string; attemptedProviders: string[] }
  | { success: false; reason: RoutingFailureReason; attemptedProviders: string[] };
