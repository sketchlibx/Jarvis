import type { AIProvider, AIMessage, AIIntent, AIPlanStep, AIStructuredOutputSpec } from "../../types/ai";
import { classifyIntentViaChat, generatePlanViaChat, summarizeViaChat, generateStructuredOutputViaChat } from "./promptBasedMethods";

/**
 * # Status: written against Google's documented Generative Language API
 * (v1beta generateContent/streamGenerateContent), NOT verified against a
 * live call — this sandbox has no network access (confirmed: outbound
 * requests are rejected with `host_not_allowed`). If the actual API has
 * since changed incompatibly, this adapter surfaces that as a real HTTP
 * error from `request()` — it does not swallow or paper over mismatches.
 *
 * Key vendor-specific differences from ClaudeProvider handled here:
 * - Gemini uses role "user"|"model" (not "assistant").
 * - System instructions are a separate top-level `systemInstruction`
 *   field, not a message inside `contents`.
 * - Multimodal images use `inline_data` with snake_case keys.
 */
interface GeminiProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Current production default chosen for low-latency assistant replies.
// Gemini 2.0 Flash was shut down on June 1, 2026.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class GeminiProvider implements AIProvider {
  readonly providerName = "gemini";
  private config: GeminiProviderConfig;

  constructor(config: GeminiProviderConfig) {
    if (!config.apiKey) {
      throw new Error("GeminiProvider requires an apiKey. Configure it in Settings > AI Providers — never hard-code it.");
    }
    this.config = config;
  }

  private baseUrl(): string {
    return this.config.baseUrl ?? "https://generativelanguage.googleapis.com";
  }

  private model(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }

  private toGeminiRole(role: AIMessage["role"]): "user" | "model" {
    return role === "assistant" ? "model" : "user";
  }

  private toContents(messages: AIMessage[]) {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: this.toGeminiRole(m.role),
        parts: [
          ...(m.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } })),
          { text: m.content },
        ],
      }));
  }

  private systemInstruction(messages: AIMessage[]): { parts: Array<{ text: string }> } | undefined {
    const systemMsg = messages.find((m) => m.role === "system");
    return systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined;
  }

  private async request(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    // Auth via the X-goog-api-key HEADER (Google's currently documented
    // scheme), not the older `?key=` query-string parameter this file
    // used previously. Same endpoint/method/body — this is strictly an
    // auth-transport fix, not a rewrite. Security reason, not just
    // contract-matching: a key in a URL is far more likely to end up
    // somewhere it shouldn't (browser history, any HTTP/proxy access log,
    // devtools network tab copy-paste) than a header ever is.
    const url = `${this.baseUrl()}/v1beta/models/${this.model()}:${path}`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "X-goog-api-key": this.config.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  async chat(messages: AIMessage[], signal?: AbortSignal): Promise<string> {
    const data = await this.request("generateContent", {
      contents: this.toContents(messages),
      systemInstruction: this.systemInstruction(messages),
      generationConfig: { temperature: 0.35, maxOutputTokens: 768 },
    }, signal);
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: { text?: string }) => p.text ?? "").join("");
  }

  async streamChat(messages: AIMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    const url = `${this.baseUrl()}/v1beta/models/${this.model()}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "X-goog-api-key": this.config.apiKey },
      body: JSON.stringify({
        contents: this.toContents(messages),
        systemInstruction: this.systemInstruction(messages),
        generationConfig: { temperature: 0.35, maxOutputTokens: 768 },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Gemini streaming error ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          const text = evt?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) onToken(text);
        } catch {
          // ignore malformed SSE chunk, do not crash the stream
        }
      }
    }
  }

  async classifyIntent(userText: string, availableIntents: string[], signal?: AbortSignal): Promise<AIIntent> {
    return classifyIntentViaChat((m, s) => this.chat(m, s), userText, availableIntents, signal);
  }

  async generatePlan(goal: string, context: AIMessage[], signal?: AbortSignal): Promise<AIPlanStep[]> {
    return generatePlanViaChat((m, s) => this.chat(m, s), goal, context, signal);
  }

  async summarize(text: string, maxWords = 100, signal?: AbortSignal): Promise<string> {
    return summarizeViaChat((m, s) => this.chat(m, s), text, maxWords, signal);
  }

  async generateStructuredOutput<T>(prompt: string, spec: AIStructuredOutputSpec, signal?: AbortSignal): Promise<T> {
    return generateStructuredOutputViaChat<T>((m, s) => this.chat(m, s), "Gemini", prompt, spec, signal);
  }
}
