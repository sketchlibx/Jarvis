import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiProvider } from "../GeminiProvider";
import { GrokProvider } from "../GrokProvider";
import { DeepSeekProvider } from "../DeepSeekProvider";

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
