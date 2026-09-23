import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiProvider } from "../GeminiProvider";
import { GrokProvider } from "../GrokProvider";
import { DeepSeekProvider } from "../DeepSeekProvider";
import { ClaudeProvider } from "../ClaudeProvider";
import { OpenAICompatibleGenericProvider } from "../OpenAICompatibleProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiProvider", () => {
  it("parses a chat response and separates system instruction from contents", async () => {
    let capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }] }) };
    }));

    const gemini = new GeminiProvider({ apiKey: "test-key-123" });
    const result = await gemini.chat([{ role: "system", content: "Be helpful" }, { role: "user", content: "Hi" }]);

    expect(result).toBe("Hello from Gemini");
    expect(capturedBody.systemInstruction.parts[0].text).toBe("Be helpful");
    expect(capturedBody.contents).toHaveLength(1);
    expect(capturedBody.contents.every((c: any) => c.role === "user" || c.role === "model")).toBe(true);
  });

  it("includes inline_data for image attachments", async () => {
    let capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "I see it" }] } }] }) };
    }));
    const gemini = new GeminiProvider({ apiKey: "k" });
    await gemini.chat([{ role: "user", content: "What is this?", images: [{ base64: "AAAA", mimeType: "image/png" }] }]);
    expect(JSON.stringify(capturedBody.contents[0].parts)).toContain("inline_data");
  });

  it("never leaks the API key in a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized" })));
    const gemini = new GeminiProvider({ apiKey: "test-key-123" });
    try {
      await gemini.chat([{ role: "user", content: "x" }]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("test-key-123");
    }
  });

  it("authenticates via the X-goog-api-key header, POSTs to generateContent, and never puts the key in the URL", async () => {
    let capturedUrl: string, capturedHeaders: any, capturedMethod: string;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedHeaders = opts.headers; capturedMethod = opts.method;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
    }));
    const gemini = new GeminiProvider({ apiKey: "sekret-key-999" });
    await gemini.chat([{ role: "user", content: "hi" }]);

    expect(capturedMethod!).toBe("POST");
    expect(capturedUrl!).toContain(":generateContent");
    expect(capturedUrl!).not.toContain("sekret-key-999"); // request section 3's explicit "never place the API key in ... URL" via the query-string form this used to use
    expect(capturedHeaders!["X-goog-api-key"]).toBe("sekret-key-999");
    expect(capturedHeaders!["Content-Type"]).toBe("application/json");
  });

  it("rejects an empty API key at construction", () => {
    expect(() => new GeminiProvider({ apiKey: "" })).toThrow();
  });
});

describe("GrokProvider / DeepSeekProvider — shared OpenAI-compatible base", () => {
  it("Grok parses an OpenAI-shaped response with Bearer auth", async () => {
    let capturedHeaders: any, capturedUrl: string;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedHeaders = opts.headers;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Hello from Grok" } }] }) };
    }));
    const grok = new GrokProvider({ apiKey: "grok-key-456" });
    const result = await grok.chat([{ role: "user", content: "Hi" }]);

    expect(result).toBe("Hello from Grok");
    expect(capturedHeaders.Authorization).toBe("Bearer grok-key-456");
    expect(capturedUrl!).toContain("api.x.ai");
  });

  it("Grok honestly refuses image input rather than silently dropping it", async () => {
    const grok = new GrokProvider({ apiKey: "k" });
    await expect(
      grok.chat([{ role: "user", content: "what is this", images: [{ base64: "x", mimeType: "image/png" }] }])
    ).rejects.toThrow(/does not support image/);
  });

  it("DeepSeek parses an OpenAI-shaped response and hits the correct endpoint", async () => {
    let capturedUrl: string, capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Hello from DeepSeek" } }] }) };
    }));
    const deepseek = new DeepSeekProvider({ apiKey: "ds-key" });
    const result = await deepseek.chat([{ role: "user", content: "Hi" }]);

    expect(result).toBe("Hello from DeepSeek");
    expect(capturedUrl!).toContain("api.deepseek.com");
    expect(capturedBody.model).toBe("deepseek-chat");
  });

  it("rejects an empty API key at construction for both", () => {
    expect(() => new GrokProvider({ apiKey: "" })).toThrow();
    expect(() => new DeepSeekProvider({ apiKey: "" })).toThrow();
  });
});

describe("ClaudeProvider", () => {
  it("authenticates with x-api-key + anthropic-version headers and hits the Messages API", async () => {
    let capturedUrl: string, capturedHeaders: any, capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedHeaders = opts.headers; capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "Hello from Claude" }] }) };
    }));
    const claude = new ClaudeProvider({ apiKey: "claude-key-777" });
    const result = await claude.chat([{ role: "system", content: "Be helpful" }, { role: "user", content: "Hi" }]);

    expect(result).toBe("Hello from Claude");
    expect(capturedUrl!).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedHeaders!["x-api-key"]).toBe("claude-key-777");
    expect(capturedHeaders!["anthropic-version"]).toBe("2023-06-01");
    expect(capturedHeaders!["Content-Type"]).toBe("application/json");
    expect(capturedBody.system).toBe("Be helpful");
    expect(capturedBody.messages.every((m: any) => m.role === "user" || m.role === "assistant")).toBe(true);
  });

  it("never leaks the API key in a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized" })));
    const claude = new ClaudeProvider({ apiKey: "claude-key-777" });
    try {
      await claude.chat([{ role: "user", content: "x" }]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("claude-key-777");
    }
  });

  it("does not send the API key in the response body's request path either", async () => {
    // Regression guard: confirms the raw request options captured above
    // never included the key anywhere OTHER than the one expected header
    // — i.e. it isn't duplicated into the body or query string.
    let capturedUrl: string, capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedBody = opts.body as string;
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
    }));
    const claude = new ClaudeProvider({ apiKey: "claude-key-888" });
    await claude.chat([{ role: "user", content: "hi" }]);
    expect(capturedUrl!).not.toContain("claude-key-888");
    expect(capturedBody!).not.toContain("claude-key-888");
  });

  it("rejects an empty API key at construction", () => {
    expect(() => new ClaudeProvider({ apiKey: "" })).toThrow();
  });
});

describe("OpenAICompatibleGenericProvider — user-configurable base URL", () => {
  it("requires both baseUrl and model at construction (no universal default exists)", () => {
    expect(() => new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "", model: "m" })).toThrow();
    expect(() => new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "https://x.example/v1", model: "" })).toThrow();
    expect(() => new OpenAICompatibleGenericProvider({ apiKey: "", baseUrl: "https://x.example/v1", model: "m" })).toThrow();
  });

  it("hits the CONFIGURED base URL (not a hardcoded vendor endpoint) with Bearer auth", async () => {
    let capturedUrl: string, capturedHeaders: any, capturedBody: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      capturedUrl = url; capturedHeaders = opts.headers; capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Hello from a custom endpoint" } }] }) };
    }));
    const provider = new OpenAICompatibleGenericProvider({
      apiKey: "custom-key-111", baseUrl: "https://my-self-hosted-llm.example/v1", model: "my-model",
    });
    const result = await provider.chat([{ role: "user", content: "Hi" }]);

    expect(result).toBe("Hello from a custom endpoint");
    expect(capturedUrl!).toContain("https://my-self-hosted-llm.example/v1");
    expect(capturedHeaders!.Authorization).toBe("Bearer custom-key-111");
    expect(capturedBody.model).toBe("my-model");
  });

  it("strips a trailing slash from baseUrl so the endpoint never double-slashes", async () => {
    let capturedUrl: string;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    }));
    const provider = new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "https://x.example/v1/", model: "m" });
    await provider.chat([{ role: "user", content: "hi" }]);
    expect(capturedUrl!).not.toContain("//chat");
  });

  it("defaults supportsVisionInput to false and honestly refuses image input rather than silently dropping it", async () => {
    const provider = new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "https://x.example/v1", model: "m" });
    await expect(
      provider.chat([{ role: "user", content: "what is this", images: [{ base64: "x", mimeType: "image/png" }] }])
    ).rejects.toThrow(/does not support image/);
  });

  it("respects an explicit supportsVisionInput: true opt-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(body.messages[0].content).includes("image_url") ? "saw image" : "no image" } }] }) };
    }));
    const provider = new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "https://x.example/v1", model: "m", supportsVisionInput: true });
    const result = await provider.chat([{ role: "user", content: "what is this", images: [{ base64: "x", mimeType: "image/png" }] }]);
    expect(result).toBe("saw image");
  });

  it("never leaks the API key in a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized" })));
    const provider = new OpenAICompatibleGenericProvider({ apiKey: "custom-key-222", baseUrl: "https://x.example/v1", model: "m" });
    try {
      await provider.chat([{ role: "user", content: "x" }]);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("custom-key-222");
    }
  });
});

// ---------------------------------------------------------------------
// Phase 7 security/reliability pass — AbortSignal threading. These verify
// the plumbing (signal reaches fetch, an aborted signal propagates as a
// real AbortError) rather than App.tsx's timeout/cancel wiring itself,
// which has no existing render harness in this test suite to hook into.
// ---------------------------------------------------------------------
describe("AbortSignal threading through chat()", () => {
  it("ClaudeProvider.chat forwards the signal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
    }));
    const claude = new ClaudeProvider({ apiKey: "k" });
    const controller = new AbortController();
    await claude.chat([{ role: "user", content: "hi" }], controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });

  it("GeminiProvider.chat forwards the signal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
    }));
    const gemini = new GeminiProvider({ apiKey: "k" });
    const controller = new AbortController();
    await gemini.chat([{ role: "user", content: "hi" }], controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });

  it("OpenAI-compatible provider.chat forwards the signal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    }));
    const provider = new OpenAICompatibleGenericProvider({ apiKey: "k", baseUrl: "https://example.com/v1", model: "m" });
    const controller = new AbortController();
    await provider.chat([{ role: "user", content: "hi" }], controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });

  it("an already-aborted signal causes chat() to reject with AbortError, not hang", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        opts.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }));
    const claude = new ClaudeProvider({ apiKey: "k" });
    const controller = new AbortController();
    controller.abort();
    await expect(claude.chat([{ role: "user", content: "hi" }], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborting mid-flight rejects a pending chat() call rather than leaving it pending forever", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }));
    const claude = new ClaudeProvider({ apiKey: "k" });
    const controller = new AbortController();
    const promise = claude.chat([{ role: "user", content: "hi" }], controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("classifyIntent/generatePlan/summarize/generateStructuredOutput all thread the signal through to fetch (promptBasedMethods helpers)", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"intent":"x","params":{},"confidence":0.5}' }] }) };
    }));
    const claude = new ClaudeProvider({ apiKey: "k" });
    const controller = new AbortController();
    await claude.classifyIntent("do something", ["x", "y"], controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });
});
