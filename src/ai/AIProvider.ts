export type { AIProvider, AIMessage, AIIntent, AIPlanStep, AIStructuredOutputSpec } from "../types/ai";
export type {
  ProviderCapability, ProviderAvailability, ProviderStatus, ProviderConfig,
  TaskType, RoutingRequest, RoutingResult, RoutingFailureReason,
} from "./types";

import type { AIProvider } from "../types/ai";
import type { ProviderAvailability, ProviderConfig, ProviderStatus, RoutingRequest, RoutingResult, TaskType } from "./types";
import { TASK_REQUIRED_CAPABILITY, initialProviderStatus } from "./types";

interface RegisteredProvider {
  provider: AIProvider;
  config: ProviderConfig;
  status: ProviderStatus;
}

/**
 * Extends the Phase 1 registry with the metadata (config + live status)
 * needed for capability-aware routing and deterministic fallback (spec
 * sections 3-5). Every method that existed in Phase 1
 * (`register`/`setActive`/`getActive`/`list`) still works exactly as
 * before — nothing that already calls this class needs to change. Routing
 * is new, additive behavior (`route`), not a replacement.
 */
class AIProviderRegistry {
  private entries = new Map<string, RegisteredProvider>();
  private activeName: string | null = null;

  // ---- Phase 1 API, unchanged behavior ----

  register(provider: AIProvider, config?: Partial<ProviderConfig>): void {
    const existing = this.entries.get(provider.providerName);
    const resolvedConfig: ProviderConfig = {
      name: provider.providerName,
      displayName: config?.displayName ?? existing?.config.displayName ?? provider.providerName,
      enabled: config?.enabled ?? existing?.config.enabled ?? true,
      hasApiKey: config?.hasApiKey ?? existing?.config.hasApiKey ?? true, // Phase 1 providers were constructed with a key already, so default true preserves old behavior
      model: config?.model ?? existing?.config.model ?? "default",
      priority: config?.priority ?? existing?.config.priority ?? this.entries.size,
      capabilities: config?.capabilities ?? existing?.config.capabilities ?? ["TEXT", "STRUCTURED_OUTPUT", "STREAMING"],
    };
    this.entries.set(provider.providerName, {
      provider,
      config: resolvedConfig,
      status: existing?.status ?? initialProviderStatus(),
    });
    if (!this.activeName) this.activeName = provider.providerName;
  }

  setActive(name: string): void {
    if (!this.entries.has(name)) {
      throw new Error(`AI provider '${name}' is not registered.`);
    }
    this.activeName = name;
  }

  getActive(): AIProvider {
    if (!this.activeName) {
      throw new Error("No AI provider registered. Configure one in Settings.");
    }
    const entry = this.entries.get(this.activeName);
    if (!entry) throw new Error(`Active provider '${this.activeName}' not found.`);
    return entry.provider;
  }

  /** Fetches a specific provider instance by name — needed because
   * `route()` may select a DIFFERENT provider than whatever is currently
   * "active" (e.g. the active provider lacks a capability the request
   * needs, so route() picked a fallback). Callers that use `route()` must
   * use THIS to actually get the provider `route()` chose, rather than
   * calling `getActive()` and silently using a different one than what
   * was routed — that mismatch was a real integration gap this method
   * closes (see `screen/ScreenPerception.ts`). */
  getProviderInstance(name: string): AIProvider | undefined {
    return this.entries.get(name)?.provider;
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  // ---- Phase 6 additions ----

  getConfig(name: string): ProviderConfig | undefined {
    return this.entries.get(name)?.config;
  }

  updateConfig(name: string, patch: Partial<Omit<ProviderConfig, "name">>): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    entry.config = { ...entry.config, ...patch };
    return true;
  }

  getStatus(name: string): ProviderStatus | undefined {
    return this.entries.get(name)?.status;
  }

  /** Called by whatever code actually made the API call, on success or
   * failure — this is what feeds "previous provider failure" into future
   * routing decisions (spec section 4), and is also the seam a
   * "Simulate AI Provider Failure" dev control (spec section 22) hooks
   * into without needing a second status-tracking mechanism. */
  recordOutcome(name: string, outcome: { success: true } | { success: false; error: string; availability?: ProviderAvailability }): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (outcome.success) {
      entry.status = { availability: "available", lastError: null, lastCheckedAt: new Date().toISOString(), consecutiveFailures: 0 };
    } else {
      entry.status = {
        availability: outcome.availability ?? "unavailable",
        lastError: outcome.error,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: entry.status.consecutiveFailures + 1,
      };
    }
  }

  allConfigs(): ProviderConfig[] {
    return [...this.entries.values()].map((e) => e.config);
  }

  /**
   * Deterministic routing (spec sections 4-5). Never sends a request to
   * every provider "just in case" — picks exactly one candidate at a time,
   * in priority order, skipping anything disabled/unconfigured/lacking the
   * required capability/currently rate-limited or invalid-key. If
   * `forceProvider` is set, this NEVER falls back to a different provider
   * — it either uses that exact one or fails visibly (spec section 4's
   * explicit "do not silently switch providers when the user explicitly
   * selected 'Only this provider'").
   *
   * This function does not itself call the provider — it only decides
   * WHICH provider a caller should use next. The caller is responsible for
   * actually invoking it and reporting the outcome via `recordOutcome`.
   */
  route(request: RoutingRequest): RoutingResult {
    if (this.entries.size === 0) {
      return { success: false, reason: "no_providers_registered", attemptedProviders: [] };
    }

    if (request.forceProvider) {
      const entry = this.entries.get(request.forceProvider);
      if (!entry) {
        return { success: false, reason: "forced_provider_not_found", attemptedProviders: [] };
      }
      if (!this.isUsable(entry, request.task)) {
        return { success: false, reason: "forced_provider_unavailable", attemptedProviders: [entry.config.name] };
      }
      return { success: true, providerName: entry.config.name, attemptedProviders: [entry.config.name] };
    }

    const requiredCapability = TASK_REQUIRED_CAPABILITY[request.task];
    const candidates = [...this.entries.values()]
      .filter((e) => e.config.capabilities.includes(requiredCapability))
      .sort((a, b) => a.config.priority - b.config.priority);

    if (candidates.length === 0) {
      return { success: false, reason: "no_provider_supports_capability", attemptedProviders: [] };
    }

    const attempted: string[] = [];
    const usableCandidates = candidates.filter((e) => e.config.enabled && e.config.hasApiKey);
    if (usableCandidates.length === 0) {
      return { success: false, reason: "all_candidates_disabled_or_unconfigured", attemptedProviders: [] };
    }

    for (const entry of usableCandidates) {
      attempted.push(entry.config.name);
      if (this.isUsable(entry, request.task)) {
        return { success: true, providerName: entry.config.name, attemptedProviders: attempted };
      }
    }

    return { success: false, reason: "all_candidates_failed", attemptedProviders: attempted };
  }

  private isUsable(entry: RegisteredProvider, task: TaskType): boolean {
    if (!entry.config.enabled || !entry.config.hasApiKey) return false;
    if (!entry.config.capabilities.includes(TASK_REQUIRED_CAPABILITY[task])) return false;
    // BUGFIX (Phase 6 completion pass): this previously only excluded
    // "invalid_key"/"disabled"/"rate_limited", but NOT the general
    // "unavailable" status that `recordOutcome` sets for an ordinary
    // failed call — meaning a provider that just failed would be
    // considered usable again immediately, defeating the entire point of
    // tracking failures. Caught by an integration test that used a real
    // provider adapter with a mocked 503 response and checked what
    // route() did *after* the failure was recorded, not just whether the
    // failure itself was recorded.
    if (
      entry.status.availability === "invalid_key" ||
      entry.status.availability === "disabled" ||
      entry.status.availability === "rate_limited" ||
      entry.status.availability === "unavailable"
    ) {
      return false;
    }
    return true;
  }
}

export const aiProviderRegistry = new AIProviderRegistry();
