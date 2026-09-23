import { describe, it, expect, beforeEach } from "vitest";
import { aiProviderRegistry } from "../AIProvider";
import type { AIProvider } from "../../types/ai";

function fakeProvider(name: string): AIProvider {
  return {
    providerName: name,
    chat: async () => "",
    streamChat: async () => {},
    classifyIntent: async () => ({ intent: "", params: {}, confidence: 0, rawText: "" }),
    generatePlan: async () => [],
    summarize: async () => "",
    generateStructuredOutput: async () => ({} as never),
  };
}

let counter = 0;
function uniqueName(base: string): string {
  counter += 1;
  return `${base}_${counter}`;
}

// Root-cause fix: `aiProviderRegistry` is a module-level singleton, and
// under a real vitest run (unlike the ad-hoc Node harnesses used to
// develop this file, which always started from a fresh `require()`) its
// state persists across every `it()` block in this file. A provider
// registered in an earlier test remained a live routing candidate for
// later tests, and — because several tests reuse overlapping
// capabilities/priorities by design (to keep each test's setup minimal)
// — an earlier test's leftover provider could win a later test's routing
// decision. `resetForTesting()` (added to AIProviderRegistry specifically
// for this) gives genuine per-test isolation without changing what any
// single test actually asserts.
beforeEach(() => {
  aiProviderRegistry.resetForTesting();
});

describe("aiProviderRegistry.route — spec sections 4, 5", () => {
  it("routes to the highest-priority provider that supports the required capability", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { displayName: "Gemini", enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT", "VISION"] });
    aiProviderRegistry.register(fakeProvider(grok), { displayName: "Grok", enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT", "WEB"] });

    const result = aiProviderRegistry.route({ task: "chat" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(gemini);
  });

  it("skips a provider lacking the required capability", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT", "WEB"] });

    const result = aiProviderRegistry.route({ task: "web_search" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(grok);
  });

  it("falls back to the next provider after a rate-limit outcome is recorded", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });
    aiProviderRegistry.recordOutcome(gemini, { success: false, error: "rate limited", availability: "rate_limited" });

    const result = aiProviderRegistry.route({ task: "chat" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(grok);
  });

  it("never routes to a disabled provider even as a last resort", () => {
    const only = uniqueName("only");
    aiProviderRegistry.register(fakeProvider(only), { enabled: false, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });

    const result = aiProviderRegistry.route({ task: "chat" });
    expect(result.success).toBe(false);
  });

  it("FAILS rather than silently switching when the forced provider is unavailable", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });
    aiProviderRegistry.recordOutcome(gemini, { success: false, error: "rate limited", availability: "rate_limited" });

    const result = aiProviderRegistry.route({ task: "chat", forceProvider: gemini });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("forced_provider_unavailable");
  });

  it("reports a clear failure for a forced provider that was never registered", () => {
    const result = aiProviderRegistry.route({ task: "chat", forceProvider: "totally_unregistered_xyz" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("forced_provider_not_found");
  });

  it("recovers to the highest-priority provider once it reports success again", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });
    aiProviderRegistry.recordOutcome(gemini, { success: false, error: "down", availability: "unavailable" });
    aiProviderRegistry.recordOutcome(gemini, { success: true });

    const result = aiProviderRegistry.route({ task: "chat" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(gemini);
  });
});

describe("aiProviderRegistry.route — preferProvider (Settings' defaultProvider + fallbackBehavior:\"fallback\")", () => {
  it("prefers the named provider over normal priority order when it's usable", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    // grok registered with a HIGHER priority (lower number = tried first)
    // than gemini, so without preferProvider grok would win.
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });

    const result = aiProviderRegistry.route({ task: "chat", preferProvider: gemini });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(gemini);
  });

  it("falls through to the normal candidate order when the preferred provider is unusable (unlike forceProvider, which fails outright)", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });
    aiProviderRegistry.recordOutcome(gemini, { success: false, error: "down", availability: "unavailable" });

    const result = aiProviderRegistry.route({ task: "chat", preferProvider: gemini });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(grok);
  });

  it("falls through when the preferred provider was never registered at all, rather than failing", () => {
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });

    const result = aiProviderRegistry.route({ task: "chat", preferProvider: "totally_unregistered_xyz" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(grok);
  });

  it("forceProvider takes precedence over preferProvider when both are somehow set", () => {
    const gemini = uniqueName("gemini");
    const grok = uniqueName("grok");
    aiProviderRegistry.register(fakeProvider(gemini), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(grok), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });

    const result = aiProviderRegistry.route({ task: "chat", forceProvider: grok, preferProvider: gemini });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(grok);
  });

  it("does not disturb the relative order of OTHER candidates when moving the preferred one to the front", () => {
    const a = uniqueName("a"), b = uniqueName("b"), c = uniqueName("c");
    aiProviderRegistry.register(fakeProvider(a), { enabled: true, hasApiKey: true, priority: 1, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(b), { enabled: true, hasApiKey: true, priority: 2, capabilities: ["TEXT"] });
    aiProviderRegistry.register(fakeProvider(c), { enabled: true, hasApiKey: true, priority: 3, capabilities: ["TEXT"] });
    // Prefer c; if a and b are both later marked unavailable, order
    // between them should remain a-before-b (their original priority
    // order), not reversed by the splice/unshift used to promote c.
    aiProviderRegistry.recordOutcome(c, { success: false, error: "down", availability: "unavailable" });
    aiProviderRegistry.recordOutcome(a, { success: false, error: "down", availability: "unavailable" });

    const result = aiProviderRegistry.route({ task: "chat", preferProvider: c });
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerName).toBe(b);
  });
});
