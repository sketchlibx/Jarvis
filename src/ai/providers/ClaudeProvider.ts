import type {
  AIProvider,
  AIMessage,
  AIIntent,
  AIPlanStep,
  AIStructuredOutputSpec,
} from "../../types/ai";

interface ClaudeProviderConfig {
  /** Never hard-code this. Read from secure settings storage (see config/settings.ts). */
  apiKey: string;
  model?: string;
  baseUrl?: string; // override for testing / proxying, defaults to api.anthropic.com
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class ClaudeProvider implements AIProvider {
  readonly providerName = "claude";
  private config: ClaudeProviderConfig;

  constructor(config: ClaudeProviderConfig) {
    if (!config.apiKey) {
      throw new Error(
        "ClaudeProvider requires an apiKey. Configure it in Settings > AI Provider — never hard-code it."
      );
    }
    this.config = config;
  }

  private endpoint(): string {
    return `${this.config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`;
  }

  private async request(body: Record<string, unknown>): Promise<any> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: 1024,
        ...body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  private toApiMessages(messages: AIMessage[]) {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (!m.images || m.images.length === 0) {
          return { role: m.role, content: m.content };
        }
        // Claude's real Messages API accepts a content BLOCK ARRAY when
        // multimodal — image blocks first is Anthropic's documented
        // convention, text block last. Added for Phase 6's completion
        // pass (screen capture -> AI); every prior caller that never set
        // `images` is unaffected (falls into the branch above, unchanged
        // from before this edit).
        return {
          role: m.role,
          content: [
            ...m.images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mimeType, data: img.base64 },
            })),
            { type: "text", text: m.content },
          ],
        };
      });
  }

  private systemPrompt(messages: AIMessage[]): string | undefined {
    return messages.find((m) => m.role === "system")?.content;
  }

  async chat(messages: AIMessage[]): Promise<string> {
    const data = await this.request({
      system: this.systemPrompt(messages),
      messages: this.toApiMessages(messages),
    });
    return (data.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }

  async streamChat(
    messages: AIMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: 1024,
        system: this.systemPrompt(messages),
        messages: this.toApiMessages(messages),
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Claude streaming error ${res.status}`);
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
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            onToken(evt.delta.text);
          }
        } catch {
          // ignore malformed SSE chunk, do not crash the stream
        }
      }
    }
  }

  async classifyIntent(userText: string, availableIntents: string[]): Promise<AIIntent> {
    const prompt = `Classify the user's request into exactly one of these intents: ${availableIntents.join(
      ", "
    )}. Respond ONLY with JSON: {"intent": string, "params": object, "confidence": number}. User text: ${JSON.stringify(
      userText
    )}`;
    const raw = await this.chat([{ role: "user", content: prompt }]);
    const parsed = safeParseJson(raw);
    return {
      intent: parsed?.intent ?? "unknown",
      params: parsed?.params ?? {},
      confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
      rawText: userText,
    };
  }

  async generatePlan(goal: string, context: AIMessage[]): Promise<AIPlanStep[]> {
    const prompt = `Given the goal: ${JSON.stringify(
      goal
    )}, produce a short ordered plan as JSON array of {"description": string, "toolId"?: string, "params"?: object}. Respond ONLY with the JSON array.`;
    const raw = await this.chat([...context, { role: "user", content: prompt }]);
    const parsed = safeParseJson(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  async summarize(text: string, maxWords = 100): Promise<string> {
    return this.chat([
      {
        role: "user",
        content: `Summarize the following in at most ${maxWords} words:\n\n${text}`,
      },
    ]);
  }

  async generateStructuredOutput<T>(prompt: string, spec: AIStructuredOutputSpec): Promise<T> {
    const full = `${prompt}\n\nRespond ONLY with valid JSON matching this schema (name: ${
      spec.schemaName
    }):\n${JSON.stringify(spec.jsonSchema)}`;
    const raw = await this.chat([{ role: "user", content: full }]);
    const parsed = safeParseJson(raw);
    if (parsed === null) throw new Error("Claude did not return valid JSON for structured output.");
    return parsed as T;
  }
}

function safeParseJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*|```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
