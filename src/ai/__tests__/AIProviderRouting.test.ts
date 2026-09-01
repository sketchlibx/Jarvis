import { describe, it, expect } from "vitest";
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
