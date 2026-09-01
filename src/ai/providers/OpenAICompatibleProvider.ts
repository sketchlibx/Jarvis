import type { AIProvider, AIMessage, AIIntent, AIPlanStep, AIStructuredOutputSpec } from "../../types/ai";
import { classifyIntentViaChat, generatePlanViaChat, summarizeViaChat, generateStructuredOutputViaChat } from "./promptBasedMethods";

/**
 * # Status: written against the OpenAI Chat Completions API shape, which
 * both xAI (Grok) and DeepSeek document as their own API's compatible
 * format. NOT verified against a live call — no network access in this
 * sandbox. Extracted as a shared base specifically because Grok and
 * DeepSeek are genuinely the same request/response contract, not two
 * independent implementations that happen to look similar.
 *
 * Each concrete subclass supplies only what's actually vendor-specific:
 * base URL, default model, and an honest capability list — this base
 * class does not decide capabilities, since claiming e.g. VISION support
 * is a per-vendor fact that must not be fabricated generically.
 */
export interface OpenAICompatibleConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract readonly providerName: string;
  protected config: OpenAICompatibleConfig;
  protected abstract defaultModel: string;
  protected abstract defaultBaseUrl: string;
  /** Whether THIS vendor's chat endpoint accepts image content blocks.
   * Subclasses must set this honestly rather than assuming every
   * OpenAI-compatible endpoint supports vision. */
  protected abstract supportsVisionInput: boolean;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.apiKey) {
      throw new Error("This provider requires an apiKey. Configure it in Settings > AI Providers — never hard-code it.");
    }
    this.config = config;
  }

  private endpoint(): string {
    return `${this.config.baseUrl ?? this.defaultBaseUrl}/chat/completions`;
  }

  private model(): string {
    return this.config.model ?? this.defaultModel;
  }

  private toApiMessages(messages: AIMessage[]) {
    return messages.map((m) => {
      if (!m.images || m.images.length === 0 || !this.supportsVisionInput) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
        ],
      };
    });
  }

  private authHeaders(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` };
  }

  async chat(messages: AIMessage[]): Promise<string> {
    if (messages.some((m) => m.images && m.images.length > 0) && !this.supportsVisionInput) {
      throw new Error(`${this.providerName} does not support image input for the current model — route vision requests to a VISION-capable provider instead.`);
    }
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ model: this.model(), messages: this.toApiMessages(messages) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${this.providerName} API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  async streamChat(messages: AIMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      signal,
      headers: this.authHeaders(),
      body: JSON.stringify({ model: this.model(), messages: this.toApiMessages(messages), stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.providerName} streaming error ${res.status}`);
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
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          const token = evt?.choices?.[0]?.delta?.content;
          if (token) onToken(token);
        } catch {
          // ignore malformed SSE chunk, do not crash the stream
        }
      }
    }
  }

  async classifyIntent(userText: string, availableIntents: string[]): Promise<AIIntent> {
    return classifyIntentViaChat((m) => this.chat(m), userText, availableIntents);
  }

  async generatePlan(goal: string, context: AIMessage[]): Promise<AIPlanStep[]> {
    return generatePlanViaChat((m) => this.chat(m), goal, context);
  }

  async summarize(text: string, maxWords = 100): Promise<string> {
    return summarizeViaChat((m) => this.chat(m), text, maxWords);
  }

  async generateStructuredOutput<T>(prompt: string, spec: AIStructuredOutputSpec): Promise<T> {
    return generateStructuredOutputViaChat<T>((m) => this.chat(m), this.providerName, prompt, spec);
  }
}
